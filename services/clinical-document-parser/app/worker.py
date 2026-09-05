from __future__ import annotations

from collections import Counter
import json
import logging
import os
import re
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
    OcrBlockMetadata,
    PageExtractionMetadata,
    extract_document,
)
from .models import ClinicalCandidate, DraftExtractionMetadata, ParseDraft
from .naming import DocumentNameSuggestion, suggest_document_name
from .parser import parse_clinical_text
from .translation import with_german_translation


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
INCOMPLETE_OCR_WARNING = (
    "OCR did not finish for every page; all proposed clinical facts require manual review."
)
INCOMPLETE_OCR_ROUTE_REASONS = {
    "document_ocr_deadline_exhausted",
    "ocr_failed_native_fragment_preserved",
    "ocr_timeout_native_fragment_preserved",
    "ocr_timeout_no_text",
    "pdf_page_count_disagreement",
    "pdf_render_failed",
}


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
    ocr_block_numbers: tuple[int, ...] = ()


CandidateBlockIndex = dict[
    int, tuple[tuple[OcrBlockMetadata, frozenset[str]], ...]
]


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
            RETURNING import.id, import.document_id, import.force_reextract
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
        job = {**claimed, **document}
        if job.get("force_reextract"):
            # A rescan must read the source file even if stale cached text was
            # repopulated by another document workflow after it was queued.
            job["extracted_text"] = None
        return job


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


def claim_naming_job(connection: Any) -> dict[str, Any] | None:
    from psycopg.rows import dict_row

    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            WITH next_job AS (
                SELECT id
                FROM document_auto_naming_jobs
                WHERE status = 'queued'
                   OR (status = 'processing' AND locked_at < now() - (%s * interval '1 second'))
                ORDER BY CASE WHEN status = 'queued' THEN 0 ELSE 1 END, created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE document_auto_naming_jobs AS job
            SET status = 'processing', worker_id = %s, locked_at = now(), updated_at = now()
            FROM next_job
            WHERE job.id = next_job.id
            RETURNING job.id, job.document_id, job.provisional_auto_name, job.requested_by
            """,
            (LEASE_SECONDS, WORKER_ID),
        )
        claimed = cursor.fetchone()
        if not claimed:
            return None
        cursor.execute(
            """
            SELECT d.storage_key, d.mime_type, d.original_filename, d.extracted_text,
                   d.art, d.category, d.is_medical,
                   NULLIF(trim(concat_ws(' ', p.first_name, p.last_name)), '') AS patient_name,
                   p.patient_id AS patient_number
            FROM documents d
            LEFT JOIN patients p ON p.id = d.patient_id
            WHERE d.id = %s AND d.file_deleted_at IS NULL
            """,
            (claimed["document_id"],),
        )
        document = cursor.fetchone()
        if not document:
            return {**claimed, "storage_key": None}
        return {**claimed, **document}


def finish_naming_job(
    connection: Any,
    job: dict[str, Any],
    extracted_text: str,
    extraction: ExtractionMetadata,
    suggestion: DocumentNameSuggestion,
) -> None:
    extraction_method = "parser_ocr" if extraction.used_ocr else "parser_native"
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE documents
            SET extracted_text = %s,
                text_extraction_status = 'completed',
                text_extraction_method = %s,
                text_extracted_at = now(),
                text_extracted_by = %s
            WHERE id = %s
            """,
            (
                extracted_text,
                extraction_method,
                job["requested_by"],
                job["document_id"],
            ),
        )
        cursor.execute(
            """
            UPDATE documents
            SET auto_name = %s,
                art = CASE
                    WHEN lower(trim(art)) IN (
                        '', 'report', 'document', 'uploaded_document',
                        'patient_upload', 'patient_medical_upload',
                        'patient_correspondence_upload', 'patient_analysis_upload',
                        'patient_conclusion_upload'
                    ) THEN %s
                    ELSE art
                END,
                category = CASE
                    WHEN category IS NULL OR lower(trim(category)) IN (
                        '', 'medical', 'medical_report', 'lab_analysis',
                        'portal_upload', 'clinic_correspondence'
                    ) THEN %s
                    ELSE category
                END,
                is_medical = is_medical OR %s,
                access_category = CASE WHEN %s THEN 'medical' ELSE access_category END,
                document_date = COALESCE(%s, document_date),
                source_person = CASE
                    WHEN %s IS NOT NULL AND lower(COALESCE(trim(source_person), '')) IN (
                        '', 'patient_portal', 'interpreter_upload', 'teamlead_upload'
                    ) THEN %s
                    ELSE source_person
                END,
                source_institution = CASE
                    WHEN %s IS NOT NULL AND COALESCE(trim(source_institution), '') = '' THEN %s
                    ELSE source_institution
                END
            WHERE id = %s AND auto_name = %s
            """,
            (
                suggestion.auto_name,
                suggestion.document_type,
                suggestion.category,
                suggestion.is_medical,
                suggestion.is_medical,
                suggestion.document_date,
                suggestion.source_person,
                suggestion.source_person,
                suggestion.source_institution,
                suggestion.source_institution,
                job["document_id"],
                job["provisional_auto_name"],
            ),
        )
        rename_applied = cursor.rowcount == 1
        result = json.dumps(
            {
                "specialty_code": suggestion.specialty_code,
                "document_type": suggestion.document_type,
                "document_date": suggestion.document_date.isoformat() if suggestion.document_date else None,
                "used_ocr": extraction.used_ocr,
                "rename_applied": rename_applied,
            },
            ensure_ascii=False,
        )
        cursor.execute(
            """
            UPDATE document_auto_naming_jobs
            SET status = 'completed', result = %s::jsonb, error_code = NULL,
                completed_at = now(), updated_at = now()
            WHERE id = %s AND status = 'processing' AND worker_id = %s
              AND locked_at >= now() - (%s * interval '1 second')
            """,
            (result, job["id"], WORKER_ID, LEASE_SECONDS),
        )
        _require_guarded_update(cursor.rowcount, str(job["id"]), "finish naming")


def fail_naming_job(connection: Any, job: dict[str, Any], error: Exception) -> None:
    del error
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE documents
            SET text_extraction_status = 'failed', text_extraction_method = 'parser',
                text_extracted_at = now(), text_extracted_by = %s
            WHERE id = %s AND text_extraction_status = 'not_started'
            """,
            (job["requested_by"], job["document_id"]),
        )
        cursor.execute(
            """
            UPDATE document_auto_naming_jobs
            SET status = 'failed', error_code = 'DOCUMENT_AUTO_NAMING_FAILED',
                completed_at = now(), updated_at = now()
            WHERE id = %s AND status = 'processing' AND worker_id = %s
              AND locked_at >= now() - (%s * interval '1 second')
            """,
            (job["id"], WORKER_ID, LEASE_SECONDS),
        )
        _require_guarded_update(cursor.rowcount, str(job["id"]), "fail naming")


def _serialize_draft(draft: dict[str, Any]) -> str:
    serialized = json.dumps(draft, ensure_ascii=False)
    if len(serialized.encode("utf-8")) > MAX_SERIALIZED_DRAFT_BYTES:
        raise ValueError("Parser draft exceeds the serialized size limit")
    return serialized


def enrich_draft_with_extraction(
    draft: ParseDraft,
    metadata: ExtractionMetadata,
    extracted_text: str | None = None,
) -> ParseDraft:
    """Attach PHI-free extraction provenance and calibrate review confidence.

    Candidate confidence after this step is a prioritization signal for human
    review. It is neither OCR confidence nor a probability that a diagnosis is
    medically true. The parser's semantic score remains separately available
    in ``normalized.semantic_confidence``.
    """

    extraction = DraftExtractionMetadata.model_validate(asdict(metadata))
    block_index = _build_candidate_block_index(metadata, extracted_text)
    document_incomplete = _document_extraction_incomplete(metadata)
    candidates = [
        _enrich_candidate_with_extraction(
            candidate,
            metadata,
            extracted_text,
            block_index,
            document_incomplete,
        )
        for candidate in draft.candidates
    ]
    warnings = list(draft.warnings)
    if any(
        "low_ocr_confidence" in candidate.normalized.get("review_reasons", [])
        for candidate in candidates
    ):
        warnings.append(LOW_OCR_WARNING)
    if document_incomplete:
        warnings.append(INCOMPLETE_OCR_WARNING)
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
    extracted_text: str | None = None,
    block_index: CandidateBlockIndex | None = None,
    document_incomplete: bool = False,
) -> ClinicalCandidate:
    evidence = _candidate_extraction_evidence(
        metadata,
        candidate.source.page,
        candidate.source.text,
        extracted_text,
        block_index,
    )
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
    if document_incomplete:
        review_reasons.append("incomplete_document_extraction")
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
        and not document_incomplete
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
                "document_extraction_complete": not document_incomplete,
            },
            "extraction_source": evidence.source,
            "document_extraction_complete": not document_incomplete,
            "extraction_pages": list(evidence.page_numbers),
            "extraction_quality": evidence.extraction_quality,
            "ocr_confidence": evidence.ocr_confidence,
            "ocr_block_numbers": list(evidence.ocr_block_numbers),
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


def _document_extraction_incomplete(metadata: ExtractionMetadata) -> bool:
    return any(
        page.route_reason in INCOMPLETE_OCR_ROUTE_REASONS
        for page in metadata.pages
    )


def _candidate_extraction_evidence(
    metadata: ExtractionMetadata,
    page_number: int | None,
    candidate_text: str | None = None,
    extracted_text: str | None = None,
    block_index: CandidateBlockIndex | None = None,
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

    block_evidence = _candidate_block_evidence(
        pages,
        page_number,
        candidate_text,
        extracted_text,
        block_index,
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
    if block_evidence is not None:
        block_quality, block_confidence, block_is_low, block_numbers = block_evidence
        return CandidateExtractionEvidence(
            source="ocr",
            page_numbers=page_numbers,
            extraction_quality=block_quality,
            ocr_confidence=block_confidence,
            native_quality=_weighted_average(native_qualities),
            low_ocr_confidence=block_is_low,
            ocr_block_numbers=block_numbers,
        )
    return CandidateExtractionEvidence(
        source=sources[0] if len(sources) == 1 else "mixed",
        page_numbers=page_numbers,
        extraction_quality=_weighted_average(qualities),
        ocr_confidence=_weighted_average(ocr_confidences),
        native_quality=_weighted_average(native_qualities),
        low_ocr_confidence=any(_is_low_confidence_ocr(page) for page in pages),
    )


def _candidate_block_evidence(
    pages: list[PageExtractionMetadata],
    page_number: int | None,
    candidate_text: str | None,
    extracted_text: str | None,
    block_index: CandidateBlockIndex | None,
) -> tuple[float | None, float | None, bool, tuple[int, ...]] | None:
    if not candidate_text or page_number is None:
        return None
    page = next(
        (
            item
            for item in pages
            if item.page_number == page_number and item.source == "ocr" and item.blocks
        ),
        None,
    )
    if page is None:
        return None
    candidate_tokens = _evidence_tokens(candidate_text)
    if not candidate_tokens:
        return None

    indexed_blocks = (block_index or {}).get(page_number)
    if indexed_blocks is None:
        indexed_blocks = _index_page_blocks(page, page_number, extracted_text)
    if not indexed_blocks:
        return None

    matches: list[OcrBlockMetadata] = []
    for block, block_tokens in indexed_blocks:
        common = candidate_tokens & block_tokens
        containment = len(common) / max(1, min(len(candidate_tokens), len(block_tokens)))
        if containment >= 0.60:
            matches.append(block)
    if not matches:
        return None

    confidences = [
        (block.confidence, max(1, block.word_count))
        for block in matches
        if block.confidence is not None
    ]
    confidence = _weighted_average(confidences)
    quality = _clamp_unit(confidence / 100.0) if confidence is not None else None
    is_low = any(
        block.confidence is None or block.confidence < OCR_LOW_CONFIDENCE_THRESHOLD
        for block in matches
    )
    return quality, confidence, is_low, tuple(block.block_number for block in matches)


def _build_candidate_block_index(
    metadata: ExtractionMetadata, extracted_text: str | None
) -> CandidateBlockIndex:
    if not extracted_text:
        return {}
    index: CandidateBlockIndex = {}
    for page in metadata.pages:
        if page.page_number is None or page.source != "ocr" or not page.blocks:
            continue
        indexed = _index_page_blocks(page, page.page_number, extracted_text)
        if indexed:
            index[page.page_number] = indexed
    return index


def _index_page_blocks(
    page: PageExtractionMetadata,
    page_number: int,
    extracted_text: str | None,
) -> tuple[tuple[OcrBlockMetadata, frozenset[str]], ...]:
    if not extracted_text:
        return ()
    document_pages = extracted_text.split("\f")
    if page_number > len(document_pages):
        return ()
    page_text = document_pages[page_number - 1].strip()
    indexed: list[tuple[OcrBlockMetadata, frozenset[str]]] = []
    for block in page.blocks:
        if block.start_char < 0 or block.end_char > len(page_text):
            continue
        tokens = frozenset(
            _evidence_tokens(page_text[block.start_char : block.end_char])
        )
        if tokens:
            indexed.append((block, tokens))
    return tuple(indexed)


def _evidence_tokens(value: str) -> set[str]:
    return {
        token.casefold()
        for token in re.findall(r"[^\W_]+", value, flags=re.UNICODE)
        if len(token) >= 2 or token.isdigit()
    }


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


def log_extraction_metrics(metadata: ExtractionMetadata, duration_seconds: float) -> None:
    """Emit aggregate operational signals without text, paths, or identifiers."""

    sources = Counter(page.source for page in metadata.pages)
    engines = Counter(
        page.ocr_engine for page in metadata.pages if page.ocr_engine is not None
    )
    route_reasons = Counter(page.route_reason for page in metadata.pages)
    low_confidence_pages = sum(
        _is_low_confidence_ocr(page) for page in metadata.pages
    )
    timed_out_pages = sum(
        "deadline" in page.route_reason or "timeout" in page.route_reason
        for page in metadata.pages
    )
    payload = {
        "event": "clinical_document_extraction",
        "duration_ms": round(max(0.0, duration_seconds) * 1000),
        "page_count": metadata.page_count,
        "text_chars": metadata.text_chars,
        "used_ocr": metadata.used_ocr,
        "sources": dict(sorted(sources.items())),
        "engines": dict(sorted(engines.items())),
        "route_reasons": dict(sorted(route_reasons.items())),
        "low_confidence_pages": low_confidence_pages,
        "timed_out_pages": timed_out_pages,
    }
    LOGGER.info("parser_metric %s", json.dumps(payload, sort_keys=True))


def log_candidate_metrics(draft: ParseDraft) -> None:
    """Emit review-routing counts without candidate values or identifiers."""

    def has_reason(candidate: ClinicalCandidate, reason: str) -> bool:
        reasons = candidate.normalized.get("review_reasons", [])
        return isinstance(reasons, list) and reason in reasons

    payload = {
        "event": "clinical_candidate_review",
        "candidate_count": len(draft.candidates),
        "selected_count": sum(candidate.selected for candidate in draft.candidates),
        "block_matched_count": sum(
            bool(candidate.normalized.get("ocr_block_numbers"))
            for candidate in draft.candidates
        ),
        "low_ocr_candidate_count": sum(
            has_reason(candidate, "low_ocr_confidence")
            for candidate in draft.candidates
        ),
        "low_extraction_candidate_count": sum(
            has_reason(candidate, "low_extraction_quality")
            for candidate in draft.candidates
        ),
    }
    LOGGER.info("parser_metric %s", json.dumps(payload, sort_keys=True))


def run() -> None:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required")
    import psycopg

    with psycopg.connect(DATABASE_URL) as connection:
        LOGGER.info("parser worker %s started", WORKER_ID)
        while True:
            naming_job: dict[str, Any] | None = None
            job: dict[str, Any] | None = None
            try:
                naming_job = claim_naming_job(connection)
                if naming_job:
                    if not naming_job.get("storage_key"):
                        raise RuntimeError("Source document is unavailable")
                    upload_root = UPLOAD_DIR.resolve()
                    path = (upload_root / str(naming_job["storage_key"])).resolve()
                    if not path.is_relative_to(upload_root):
                        raise RuntimeError("Invalid source document storage path")
                    if path.stat().st_size > MAX_FILE_BYTES:
                        raise ValueError("Document exceeds the parser size limit")
                    data = path.read_bytes()
                    extraction_started = time.monotonic()
                    extracted = extract_document(
                        data,
                        naming_job.get("mime_type"),
                        naming_job.get("extracted_text"),
                    )
                    log_extraction_metrics(
                        extracted.metadata, time.monotonic() - extraction_started
                    )
                    suggestion = suggest_document_name(
                        extracted_text=extracted.text,
                        original_filename=naming_job.get("original_filename"),
                        art=naming_job.get("art"),
                        category=naming_job.get("category"),
                        is_medical=bool(naming_job.get("is_medical")),
                        patient_name=(
                            naming_job.get("patient_name")
                            or naming_job.get("patient_number")
                        ),
                    )
                    finish_naming_job(
                        connection,
                        naming_job,
                        extracted.text,
                        extracted.metadata,
                        suggestion,
                    )
                    LOGGER.info("named uploaded patient document")
                    continue
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
                extraction_started = time.monotonic()
                extraction = extract_document(
                    data,
                    job.get("mime_type"),
                    job.get("extracted_text"),
                )
                log_extraction_metrics(
                    extraction.metadata, time.monotonic() - extraction_started
                )
                parsed = parse_clinical_text(extraction.text)
                enriched = enrich_draft_with_extraction(
                    parsed, extraction.metadata, extraction.text
                )
                log_candidate_metrics(enriched)
                enriched = with_german_translation(enriched)
                draft = enriched.model_dump()
                finish_job(connection, str(job["id"]), draft)
                LOGGER.info("parsed clinical document import")
            except LeaseLostError:
                connection.rollback()
                LOGGER.warning("parser lease lost; result discarded")
            except Exception as exc:  # keep the queue alive after a bad document
                connection.rollback()
                if naming_job and naming_job.get("id"):
                    LOGGER.error("document auto naming failed (%s)", type(exc).__name__)
                    try:
                        fail_naming_job(connection, naming_job, exc)
                    except LeaseLostError:
                        connection.rollback()
                        LOGGER.warning("parser lease lost; naming failure not persisted")
                    except Exception as persist_exc:
                        connection.rollback()
                        LOGGER.error(
                            "could not persist document naming failure (%s)",
                            type(persist_exc).__name__,
                        )
                        time.sleep(POLL_SECONDS)
                elif job and job.get("id"):
                    LOGGER.error(
                        "clinical document parsing failed (%s)", type(exc).__name__
                    )
                    try:
                        fail_job(connection, str(job["id"]), exc)
                    except LeaseLostError:
                        connection.rollback()
                        LOGGER.warning("parser lease lost; failure not persisted")
                    except Exception as persist_exc:
                        connection.rollback()
                        LOGGER.error(
                            "could not persist clinical document parser failure (%s)",
                            type(persist_exc).__name__,
                        )
                        time.sleep(POLL_SECONDS)
                else:
                    time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    run()
