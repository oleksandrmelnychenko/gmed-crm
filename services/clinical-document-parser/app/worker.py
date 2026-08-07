from __future__ import annotations

import json
import logging
import os
import socket
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .extraction import (
    MAX_FILE_BYTES,
    OCR_LOW_CONFIDENCE_THRESHOLD,
    ExtractionMetadata,
    PageExtractionMetadata,
    extract_document,
)
from .models import ClinicalCandidate, DraftExtractionMetadata, ParseDraft
from .parser import parse_clinical_text


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
LOGGER = logging.getLogger("gmed.clinical_document_parser")
DATABASE_URL = os.environ.get("DATABASE_URL", "")
UPLOAD_DIR = Path(os.environ.get("GMED_UPLOAD_DIR", "/app/uploads/documents"))
POLL_SECONDS = float(os.environ.get("PARSER_POLL_SECONDS", "2"))
LEASE_SECONDS = max(1, int(os.environ.get("PARSER_LEASE_SECONDS", "900")))
MAX_SERIALIZED_DRAFT_BYTES = int(os.environ.get("PARSER_MAX_SERIALIZED_DRAFT_BYTES", str(2 * 1024 * 1024)))
OCR_LOW_CONFIDENCE_WORD_RATIO_THRESHOLD = float(
    os.environ.get("PARSER_OCR_LOW_CONFIDENCE_WORD_RATIO_THRESHOLD", "0.35")
)
LOW_EXTRACTION_QUALITY_THRESHOLD = float(
    os.environ.get("PARSER_LOW_EXTRACTION_QUALITY_THRESHOLD", "0.60")
)
WORKER_NAME = os.environ.get("PARSER_WORKER_ID", socket.gethostname())
WORKER_ID = f"{WORKER_NAME}:{os.getpid()}:{uuid.uuid4().hex[:12]}"
PUBLIC_ERROR_CODE = "CLINICAL_DOCUMENT_PARSER_FAILED"
PUBLIC_ERROR_MESSAGE = "The document could not be parsed. Review the file and try again."
PUBLIC_ERROR = f"{PUBLIC_ERROR_CODE}: {PUBLIC_ERROR_MESSAGE}"
LOW_OCR_WARNING = "Low-confidence OCR evidence requires manual review."


class LeaseLostError(RuntimeError):
    pass


@dataclass(frozen=True)
class CandidateExtractionEvidence:
    source: str
    page_numbers: tuple[int, ...]
    extraction_quality: float | None
    ocr_confidence: float | None
    native_quality: float | None
    low_ocr_confidence: bool


def claim_job(connection: Any) -> dict[str, Any] | None:
    from psycopg.rows import dict_row

    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            WITH next_job AS (
                SELECT id
                FROM clinical_document_imports
                WHERE deleted_at IS NULL
                  AND (
                    status = 'queued'
                    OR (status = 'processing' AND locked_at < now() - (%s * interval '1 second'))
                  )
                ORDER BY CASE WHEN status = 'queued' THEN 0 ELSE 1 END, created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE clinical_document_imports AS import
            SET status = 'processing', worker_id = %s, locked_at = now(), updated_at = now()
            FROM next_job
            WHERE import.id = next_job.id
            RETURNING import.id, import.document_id
            """,
            (LEASE_SECONDS, WORKER_ID),
        )
        claimed = cursor.fetchone()
        if not claimed:
            return None
        cursor.execute(
            """
            SELECT d.storage_key, d.mime_type, d.extracted_text
            FROM documents d
            WHERE d.id = %s AND d.file_deleted_at IS NULL
            """,
            (claimed["document_id"],),
        )
        document = cursor.fetchone()
        if not document:
            return {**claimed, "storage_key": None, "mime_type": None, "extracted_text": None}
        return {**claimed, **document}


def finish_job(connection: Any, job_id: str, draft: dict[str, Any]) -> None:
    serialized_draft = _serialize_draft(draft)
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE clinical_document_imports
            SET status = 'review_required', document_type = %s, source_language = %s,
                parser_version = %s, draft = %s::jsonb, completed_at = now(),
                error_message = NULL, updated_at = now()
            WHERE id = %s AND status = 'processing' AND worker_id = %s
              AND deleted_at IS NULL
              AND locked_at >= now() - (%s * interval '1 second')
            """,
            (
                draft["document_type"],
                draft.get("source_language"),
                draft["parser_version"],
                serialized_draft,
                job_id,
                WORKER_ID,
                LEASE_SECONDS,
            ),
        )
        _require_guarded_update(cursor.rowcount, job_id, "finish")


def fail_job(connection: Any, job_id: str, error: Exception) -> None:
    # The exception is intentionally not persisted: it may contain paths,
    # document fragments, driver details, or other sensitive information.
    del error
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE clinical_document_imports
            SET status = 'failed', error_message = %s, completed_at = now(), updated_at = now()
            WHERE id = %s AND status = 'processing' AND worker_id = %s
              AND deleted_at IS NULL
              AND locked_at >= now() - (%s * interval '1 second')
            """,
            (PUBLIC_ERROR, job_id, WORKER_ID, LEASE_SECONDS),
        )
        _require_guarded_update(cursor.rowcount, job_id, "fail")


def _serialize_draft(draft: dict[str, Any]) -> str:
    serialized = json.dumps(draft, ensure_ascii=False)
    if len(serialized.encode("utf-8")) > MAX_SERIALIZED_DRAFT_BYTES:
        raise ValueError("Parser draft exceeds the serialized size limit")
    return serialized


def enrich_draft_with_extraction(
    draft: ParseDraft,
    metadata: ExtractionMetadata,
) -> ParseDraft:
    """Attach PHI-free extraction provenance and calibrate review confidence.

    Candidate confidence after this step is a prioritization signal for human
    review. It is neither OCR confidence nor a probability that a diagnosis is
    medically true. The parser's semantic score remains separately available
    in ``normalized.semantic_confidence``.
    """

    extraction = DraftExtractionMetadata.model_validate(asdict(metadata))
    candidates = [
        _enrich_candidate_with_extraction(candidate, metadata)
        for candidate in draft.candidates
    ]
    warnings = list(draft.warnings)
    if any(
        "low_ocr_confidence" in candidate.normalized.get("review_reasons", [])
        for candidate in candidates
    ):
        warnings.append(LOW_OCR_WARNING)
    return draft.model_copy(
        update={
            "candidates": candidates,
            "warnings": list(dict.fromkeys(warnings)),
            "extraction": extraction,
        }
    )


def _enrich_candidate_with_extraction(
    candidate: ClinicalCandidate,
    metadata: ExtractionMetadata,
) -> ClinicalCandidate:
    evidence = _candidate_extraction_evidence(metadata, candidate.source.page)
    normalized = dict(candidate.normalized)
    stored_semantic = normalized.get("semantic_confidence")
    semantic_confidence = (
        _clamp_unit(float(stored_semantic))
        if isinstance(stored_semantic, int | float)
        else _clamp_unit(candidate.confidence)
    )
    review_confidence = _review_confidence(
        semantic_confidence,
        evidence.extraction_quality,
    )

    semantic_basis = normalized.get("semantic_confidence_basis")
    if semantic_basis is None and normalized.get("confidence_basis") is not None:
        semantic_basis = normalized["confidence_basis"]
    if semantic_basis is not None:
        normalized["semantic_confidence_basis"] = semantic_basis

    review_reasons = [
        value
        for value in normalized.get("review_reasons", [])
        if isinstance(value, str)
    ]
    low_extraction_quality = (
        evidence.extraction_quality is not None
        and evidence.extraction_quality < LOW_EXTRACTION_QUALITY_THRESHOLD
    )
    extraction_quality_unavailable = evidence.extraction_quality is None
    if evidence.low_ocr_confidence:
        review_reasons.append("low_ocr_confidence")
    if low_extraction_quality:
        review_reasons.append("low_extraction_quality")
    if extraction_quality_unavailable:
        review_reasons.append("extraction_quality_unavailable")
    review_reasons = list(dict.fromkeys(review_reasons))

    assertion = normalized.get("assertion")
    semantic_role = normalized.get("semantic_role")
    semantic_risk = (
        normalized.get("auto_select") is False
        or assertion in {"suspected", "negated", "rule_out"}
        or semantic_role in {"diagnostic_intent", "negative_finding"}
    )
    selected = bool(
        candidate.selected
        and not semantic_risk
        and not evidence.low_ocr_confidence
        and not low_extraction_quality
        and not extraction_quality_unavailable
    )

    normalized.update(
        {
            "semantic_confidence": semantic_confidence,
            "review_confidence": review_confidence,
            "confidence_kind": "review_confidence_not_medical_accuracy",
            "confidence_basis": {
                "method": "semantic_extraction_review_v1",
                "semantic_confidence": semantic_confidence,
                "extraction_quality": evidence.extraction_quality,
                "formula": "semantic * (0.5 + 0.5 * extraction_quality)",
                "missing_quality_factor": 0.75,
                "extraction_source": evidence.source,
            },
            "extraction_source": evidence.source,
            "extraction_pages": list(evidence.page_numbers),
            "extraction_quality": evidence.extraction_quality,
            "ocr_confidence": evidence.ocr_confidence,
            "native_quality": evidence.native_quality,
            "review_reasons": review_reasons,
            "auto_select": selected,
        }
    )
    return ClinicalCandidate.model_validate(
        {
            **candidate.model_dump(),
            "normalized": normalized,
            "confidence": review_confidence,
            "selected": selected,
        }
    )


def _candidate_extraction_evidence(
    metadata: ExtractionMetadata,
    page_number: int | None,
) -> CandidateExtractionEvidence:
    pages = _pages_for_candidate(metadata, page_number)
    if not pages:
        return CandidateExtractionEvidence(
            source="unavailable",
            page_numbers=(),
            extraction_quality=None,
            ocr_confidence=None,
            native_quality=None,
            low_ocr_confidence=False,
        )

    qualities = [
        (quality, _page_weight(page))
        for page in pages
        if (quality := _page_extraction_quality(page)) is not None
    ]
    ocr_confidences = [
        (page.ocr_confidence, _page_weight(page))
        for page in pages
        if page.ocr_confidence is not None
    ]
    native_qualities = [
        (page.native_quality, _page_weight(page))
        for page in pages
        if page.native_quality is not None
    ]
    sources = list(dict.fromkeys(page.source for page in pages))
    page_numbers = tuple(
        page.page_number for page in pages if page.page_number is not None
    )
    return CandidateExtractionEvidence(
        source=sources[0] if len(sources) == 1 else "mixed",
        page_numbers=page_numbers,
        extraction_quality=_weighted_average(qualities),
        ocr_confidence=_weighted_average(ocr_confidences),
        native_quality=_weighted_average(native_qualities),
        low_ocr_confidence=any(_is_low_confidence_ocr(page) for page in pages),
    )


def _pages_for_candidate(
    metadata: ExtractionMetadata,
    page_number: int | None,
) -> list[PageExtractionMetadata]:
    pages = list(metadata.pages)
    if page_number is None:
        return pages
    exact = [page for page in pages if page.page_number == page_number]
    if exact:
        return exact
    document_level = [page for page in pages if page.page_number is None]
    if document_level:
        return document_level
    return pages if len(pages) == 1 else []


def _page_extraction_quality(page: PageExtractionMetadata) -> float | None:
    if page.source == "ocr":
        if page.ocr_confidence is None:
            return None
        quality = _clamp_unit(page.ocr_confidence / 100.0)
        if page.low_confidence_word_ratio is not None:
            quality *= 1.0 - 0.35 * _clamp_unit(page.low_confidence_word_ratio)
        return round(_clamp_unit(quality), 4)
    if page.native_quality is None:
        return None
    return round(_clamp_unit(page.native_quality), 4)


def _is_low_confidence_ocr(page: PageExtractionMetadata) -> bool:
    if page.source != "ocr":
        return False
    return bool(
        page.ocr_confidence is None
        or page.ocr_confidence < OCR_LOW_CONFIDENCE_THRESHOLD
        or (
            page.low_confidence_word_ratio is not None
            and page.low_confidence_word_ratio
            > OCR_LOW_CONFIDENCE_WORD_RATIO_THRESHOLD
        )
    )


def _review_confidence(
    semantic_confidence: float,
    extraction_quality: float | None,
) -> float:
    semantic = _clamp_unit(semantic_confidence)
    if extraction_quality is None:
        return round(semantic * 0.75, 2)
    extraction = _clamp_unit(extraction_quality)
    return round(semantic * (0.5 + 0.5 * extraction), 2)


def _weighted_average(values: list[tuple[float, int]]) -> float | None:
    total_weight = sum(weight for _, weight in values)
    if total_weight <= 0:
        return None
    return round(
        sum(value * weight for value, weight in values) / total_weight,
        4,
    )


def _page_weight(page: PageExtractionMetadata) -> int:
    return max(page.word_count, page.native_char_count, 1)


def _clamp_unit(value: float) -> float:
    return max(0.0, min(1.0, value))


def _require_guarded_update(rows_affected: int, job_id: str, action: str) -> None:
    if rows_affected != 1:
        raise LeaseLostError(f"Cannot {action} import {job_id}: worker lease is no longer current")


def run() -> None:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required")
    import psycopg

    with psycopg.connect(DATABASE_URL) as connection:
        LOGGER.info("parser worker %s started", WORKER_ID)
        while True:
            job: dict[str, Any] | None = None
            try:
                job = claim_job(connection)
                if not job:
                    time.sleep(POLL_SECONDS)
                    continue
                if not job.get("storage_key"):
                    raise RuntimeError("Source document is unavailable")
                upload_root = UPLOAD_DIR.resolve()
                path = (upload_root / str(job["storage_key"])).resolve()
                if not path.is_relative_to(upload_root):
                    raise RuntimeError("Invalid source document storage path")
                if path.stat().st_size > MAX_FILE_BYTES:
                    raise ValueError("Document exceeds the parser size limit")
                data = path.read_bytes()
                extraction = extract_document(
                    data,
                    job.get("mime_type"),
                    job.get("extracted_text"),
                )
                parsed = parse_clinical_text(extraction.text)
                draft = enrich_draft_with_extraction(parsed, extraction.metadata).model_dump()
                finish_job(connection, str(job["id"]), draft)
                LOGGER.info("parsed clinical document import %s", job["id"])
            except LeaseLostError:
                connection.rollback()
                if job and job.get("id"):
                    LOGGER.warning("parser lease lost for clinical document import %s; result discarded", job["id"])
                else:
                    LOGGER.warning("parser lease lost; result discarded")
            except Exception as exc:  # keep the queue alive after a bad document
                connection.rollback()
                LOGGER.exception("clinical document parsing failed")
                if job and job.get("id"):
                    try:
                        fail_job(connection, str(job["id"]), exc)
                    except LeaseLostError:
                        connection.rollback()
                        LOGGER.warning(
                            "parser lease lost for clinical document import %s; failure not persisted",
                            job["id"],
                        )
                    except Exception:
                        connection.rollback()
                        LOGGER.exception("could not persist clinical document parser failure")
                        time.sleep(POLL_SECONDS)
                else:
                    time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    run()
