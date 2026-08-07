import sys
from dataclasses import asdict
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from pydantic import ValidationError

from app.extraction import (
    ExtractionMetadata,
    OcrBlockMetadata,
    PageExtractionMetadata,
)
from app.models import (
    ClinicalCandidate,
    DraftExtractionMetadata,
    MAX_DRAFT_CANDIDATES,
    MAX_SOURCE_EVIDENCE_CHARS,
    ParseDraft,
    SourceEvidence,
)
from app import worker


class WorkerHardeningTest(unittest.TestCase):
    def test_claim_job_uses_configurable_lease(self) -> None:
        cursor = FakeCursor(
            fetch_rows=[
                {"id": "job-1", "document_id": "document-1"},
                {"storage_key": "file.pdf", "mime_type": "application/pdf", "extracted_text": None},
            ]
        )
        connection = FakeConnection(cursor)
        fake_psycopg_rows = SimpleNamespace(dict_row=object())

        with patch.dict(sys.modules, {"psycopg.rows": fake_psycopg_rows}):
            with patch.object(worker, "LEASE_SECONDS", 37), patch.object(worker, "WORKER_ID", "worker-test"):
                job = worker.claim_job(connection)

        self.assertEqual(job["storage_key"], "file.pdf")
        self.assertEqual(cursor.executions[0][1], (37, "worker-test"))
        self.assertIn("interval '1 second'", cursor.executions[0][0])

    def test_finish_requires_current_worker_lease(self) -> None:
        connection = FakeConnection(FakeCursor(rowcount=0))

        with patch.object(worker, "WORKER_ID", "stale-worker"):
            with self.assertRaises(worker.LeaseLostError):
                worker.finish_job(connection, "job-1", sample_draft())

    def test_finish_serializes_and_updates_with_current_lease(self) -> None:
        cursor = FakeCursor(rowcount=1)
        connection = FakeConnection(cursor)

        with patch.object(worker, "WORKER_ID", "worker-test"), patch.object(worker, "LEASE_SECONDS", 37):
            worker.finish_job(connection, "job-1", sample_draft())

        parameters = cursor.executions[0][1]
        self.assertIn('"document_type": "medical_report"', parameters[3])
        self.assertEqual(parameters[-3:], ("job-1", "worker-test", 37))
        self.assertIn("locked_at >=", cursor.executions[0][0])

    def test_fail_requires_current_worker_lease(self) -> None:
        connection = FakeConnection(FakeCursor(rowcount=0))

        with patch.object(worker, "WORKER_ID", "stale-worker"):
            with self.assertRaises(worker.LeaseLostError):
                worker.fail_job(connection, "job-1", RuntimeError("private details"))

    def test_failure_persists_only_stable_public_error(self) -> None:
        cursor = FakeCursor(rowcount=1)
        connection = FakeConnection(cursor)
        private_detail = "private path and document detail"

        with patch.object(worker, "WORKER_ID", "worker-test"):
            worker.fail_job(connection, "job-1", RuntimeError(private_detail))

        parameters = cursor.executions[0][1]
        self.assertEqual(parameters[0], worker.PUBLIC_ERROR)
        self.assertNotIn(private_detail, repr(parameters))

    def test_serialized_draft_size_limit_is_enforced_before_update(self) -> None:
        cursor = FakeCursor(rowcount=1)
        connection = FakeConnection(cursor)

        with patch.object(worker, "MAX_SERIALIZED_DRAFT_BYTES", 20):
            with self.assertRaisesRegex(ValueError, "serialized size limit"):
                worker.finish_job(connection, "job-1", sample_draft())

        self.assertEqual(cursor.executions, [])

    def test_source_evidence_character_limit_is_enforced(self) -> None:
        with self.assertRaises(ValidationError):
            SourceEvidence(section="Befund", text="x" * (MAX_SOURCE_EVIDENCE_CHARS + 1))

    def test_candidate_count_limit_is_enforced(self) -> None:
        candidate = ClinicalCandidate(
            id="candidate-1",
            target="diagnosis",
            value="Hypertonie",
            confidence=0.9,
            source=SourceEvidence(section="Diagnosen", text="Hypertonie"),
        )

        with self.assertRaises(ValidationError):
            ParseDraft(
                document_type="medical_report",
                parser_version="test",
                candidates=[candidate] * (MAX_DRAFT_CANDIDATES + 1),
            )

    def test_high_quality_native_text_preserves_safe_selection(self) -> None:
        enriched = worker.enrich_draft_with_extraction(
            draft_with_candidate(),
            extraction_metadata(
                PageExtractionMetadata(
                    page_number=1,
                    source="native",
                    route_reason="native_text_passed_quality_checks",
                    native_quality=0.9,
                    native_char_count=120,
                    word_count=20,
                )
            ),
        )

        candidate = enriched.candidates[0]
        self.assertTrue(candidate.selected)
        self.assertEqual(candidate.confidence, 0.85)
        self.assertEqual(candidate.normalized["semantic_confidence"], 0.9)
        self.assertEqual(candidate.normalized["review_confidence"], 0.85)
        self.assertEqual(candidate.normalized["native_quality"], 0.9)
        self.assertIsNone(candidate.normalized["ocr_confidence"])
        self.assertEqual(
            candidate.normalized["confidence_kind"],
            "review_confidence_not_medical_accuracy",
        )

    def test_low_ocr_confidence_forces_manual_review(self) -> None:
        enriched = worker.enrich_draft_with_extraction(
            draft_with_candidate(),
            extraction_metadata(
                PageExtractionMetadata(
                    page_number=1,
                    source="ocr",
                    route_reason="native_text_empty",
                    native_quality=0.0,
                    native_char_count=0,
                    ocr_confidence=50.0,
                    low_confidence_word_ratio=0.5,
                    ocr_languages="deu+eng",
                    word_count=20,
                )
            ),
        )

        candidate = enriched.candidates[0]
        self.assertFalse(candidate.selected)
        self.assertLess(candidate.confidence, candidate.normalized["semantic_confidence"])
        self.assertEqual(candidate.normalized["ocr_confidence"], 50.0)
        self.assertEqual(candidate.normalized["native_quality"], 0.0)
        self.assertIn("low_ocr_confidence", candidate.normalized["review_reasons"])
        self.assertIn("low_extraction_quality", candidate.normalized["review_reasons"])
        self.assertIn(worker.LOW_OCR_WARNING, enriched.warnings)

    def test_missing_ocr_confidence_is_not_treated_as_high_quality(self) -> None:
        enriched = worker.enrich_draft_with_extraction(
            draft_with_candidate(),
            extraction_metadata(
                PageExtractionMetadata(
                    page_number=1,
                    source="ocr",
                    route_reason="image_document",
                    native_quality=0.0,
                    native_char_count=0,
                    ocr_confidence=None,
                    word_count=5,
                )
            ),
        )

        candidate = enriched.candidates[0]
        self.assertFalse(candidate.selected)
        self.assertEqual(candidate.confidence, 0.68)
        self.assertIn("low_ocr_confidence", candidate.normalized["review_reasons"])
        self.assertIn(
            "extraction_quality_unavailable",
            candidate.normalized["review_reasons"],
        )

    def test_candidate_uses_its_source_page_not_document_wide_ocr_risk(self) -> None:
        metadata = ExtractionMetadata(
            page_count=2,
            text_chars=240,
            used_ocr=True,
            pages=(
                PageExtractionMetadata(
                    page_number=1,
                    source="ocr",
                    route_reason="native_text_empty",
                    native_quality=0.0,
                    native_char_count=0,
                    ocr_confidence=40.0,
                    low_confidence_word_ratio=0.7,
                    word_count=20,
                ),
                PageExtractionMetadata(
                    page_number=2,
                    source="native",
                    route_reason="native_text_passed_quality_checks",
                    native_quality=0.95,
                    native_char_count=120,
                    word_count=20,
                ),
            ),
        )
        enriched = worker.enrich_draft_with_extraction(
            draft_with_candidate(page=2),
            metadata,
        )

        candidate = enriched.candidates[0]
        self.assertTrue(candidate.selected)
        self.assertEqual(candidate.normalized["extraction_source"], "native")
        self.assertEqual(candidate.normalized["extraction_pages"], [2])
        self.assertNotIn("low_ocr_confidence", candidate.normalized["review_reasons"])

    def test_semantically_risky_candidate_stays_unselected_with_good_ocr(self) -> None:
        draft = draft_with_candidate(
            selected=False,
            normalized={
                "assertion": "suspected",
                "semantic_role": "diagnosis",
                "auto_select": False,
                "review_reasons": ["suspected_diagnosis_requires_confirmation"],
            },
        )
        enriched = worker.enrich_draft_with_extraction(
            draft,
            extraction_metadata(
                PageExtractionMetadata(
                    page_number=1,
                    source="ocr",
                    route_reason="native_text_empty",
                    native_quality=0.0,
                    native_char_count=0,
                    ocr_confidence=96.0,
                    low_confidence_word_ratio=0.02,
                    word_count=20,
                )
            ),
        )

        self.assertFalse(enriched.candidates[0].selected)
        self.assertFalse(enriched.candidates[0].normalized["auto_select"])

    def test_draft_extraction_metadata_contains_geometry_but_no_text_field(self) -> None:
        metadata = extraction_metadata(
            PageExtractionMetadata(
                page_number=1,
                source="ocr",
                route_reason="native_text_empty",
                native_quality=0.0,
                native_char_count=0,
                ocr_confidence=92.0,
                low_confidence_word_ratio=0.05,
                ocr_engine="paddle",
                word_count=2,
                blocks=(
                    OcrBlockMetadata(
                        block_number=1,
                        bbox=(10, 20, 100, 30),
                        start_char=0,
                        end_char=18,
                        confidence=92.0,
                        word_count=2,
                    ),
                ),
            )
        )
        payload = DraftExtractionMetadata.model_validate(asdict(metadata)).model_dump()

        def assert_no_text_key(value: object) -> None:
            if isinstance(value, dict):
                self.assertNotIn("text", value)
                for nested in value.values():
                    assert_no_text_key(nested)
            elif isinstance(value, list):
                for nested in value:
                    assert_no_text_key(nested)

        assert_no_text_key(payload)
        self.assertEqual(payload["pages"][0]["blocks"][0]["bbox"], (10, 20, 100, 30))
        self.assertEqual(payload["pages"][0]["ocr_engine"], "paddle")


def sample_draft() -> dict:
    return {
        "document_type": "medical_report",
        "source_language": "de",
        "parser_version": "test",
        "candidates": [],
        "warnings": [],
    }


def draft_with_candidate(
    *,
    page: int | None = 1,
    selected: bool = True,
    normalized: dict | None = None,
) -> ParseDraft:
    return ParseDraft(
        document_type="medical_report",
        parser_version="test",
        candidates=[
            ClinicalCandidate(
                id="candidate-1",
                target="diagnosis",
                value="Arterielle Hypertonie",
                normalized=normalized
                or {
                    "assertion": "confirmed",
                    "semantic_role": "diagnosis",
                    "auto_select": True,
                    "review_reasons": [],
                    "confidence_basis": {"method": "semantic_rules_v1"},
                },
                confidence=0.9,
                selected=selected,
                source=SourceEvidence(
                    page=page,
                    section="Diagnosen",
                    text="Arterielle Hypertonie",
                ),
            )
        ],
    )


def extraction_metadata(page: PageExtractionMetadata) -> ExtractionMetadata:
    return ExtractionMetadata(
        page_count=1,
        text_chars=120,
        used_ocr=page.source == "ocr",
        pages=(page,),
    )


class FakeCursor:
    def __init__(self, *, rowcount: int = 1, fetch_rows: list[dict | None] | None = None) -> None:
        self.rowcount = rowcount
        self.fetch_rows = list(fetch_rows or [])
        self.executions: list[tuple[str, tuple | None]] = []

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None

    def execute(self, query: str, parameters: tuple | None = None) -> None:
        self.executions.append((query, parameters))

    def fetchone(self) -> dict | None:
        return self.fetch_rows.pop(0) if self.fetch_rows else None


class FakeTransaction:
    def __enter__(self) -> "FakeTransaction":
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        return None


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self.fake_cursor = cursor

    def transaction(self) -> FakeTransaction:
        return FakeTransaction()

    def cursor(self, **_kwargs: object) -> FakeCursor:
        return self.fake_cursor


if __name__ == "__main__":
    unittest.main()
