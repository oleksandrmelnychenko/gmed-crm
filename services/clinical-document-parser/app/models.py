from __future__ import annotations

import os
from typing import Any, Literal

from pydantic import BaseModel, Field


Target = Literal["diagnosis", "anamnesis", "medication", "examination", "recommendation"]
ExtractionSource = Literal["native", "ocr", "native_fallback", "existing", "text"]
MAX_DRAFT_CANDIDATES = int(os.environ.get("PARSER_MAX_DRAFT_CANDIDATES", "500"))
MAX_SOURCE_EVIDENCE_CHARS = int(os.environ.get("PARSER_MAX_SOURCE_EVIDENCE_CHARS", "20000"))
MAX_DRAFT_RAW_TEXT_CHARS = int(os.environ.get("PARSER_MAX_EXTRACTED_TEXT_CHARS", "500000"))
MAX_DRAFT_EXTRACTION_PAGES = int(os.environ.get("PARSER_MAX_PDF_PAGES", "80"))
MAX_DRAFT_OCR_BLOCKS_PER_PAGE = int(
    os.environ.get("PARSER_MAX_DRAFT_OCR_BLOCKS_PER_PAGE", "5000")
)


class SourceEvidence(BaseModel):
    page: int | None = None
    section: str
    text: str = Field(max_length=MAX_SOURCE_EVIDENCE_CHARS)


class ClinicalCandidate(BaseModel):
    id: str
    target: Target
    value: str
    normalized: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(ge=0.0, le=1.0)
    selected: bool = True
    source: SourceEvidence


class DraftOcrBlockMetadata(BaseModel):
    """OCR geometry only; intentionally contains no recognized medical text."""

    block_number: int
    bbox: tuple[int, int, int, int]
    start_char: int = Field(ge=0)
    end_char: int = Field(ge=0)
    confidence: float | None = Field(default=None, ge=0.0, le=100.0)
    word_count: int = Field(ge=0)


class DraftPageExtractionMetadata(BaseModel):
    page_number: int | None = Field(default=None, ge=1)
    source: ExtractionSource
    route_reason: str = Field(max_length=160)
    native_quality: float | None = Field(default=None, ge=0.0, le=1.0)
    native_char_count: int = Field(ge=0)
    ocr_confidence: float | None = Field(default=None, ge=0.0, le=100.0)
    low_confidence_word_ratio: float | None = Field(default=None, ge=0.0, le=1.0)
    ocr_languages: str | None = Field(default=None, max_length=80)
    ocr_engine: str | None = Field(default=None, max_length=32)
    orientation_rotation: int = 0
    deskew_angle: float = 0.0
    word_count: int = Field(default=0, ge=0)
    blocks: list[DraftOcrBlockMetadata] = Field(
        default_factory=list,
        max_length=MAX_DRAFT_OCR_BLOCKS_PER_PAGE,
    )


class DraftExtractionMetadata(BaseModel):
    """Non-text extraction provenance stored alongside a review draft."""

    page_count: int = Field(ge=0, le=MAX_DRAFT_EXTRACTION_PAGES)
    text_chars: int = Field(ge=0, le=MAX_DRAFT_RAW_TEXT_CHARS)
    used_ocr: bool
    pages: list[DraftPageExtractionMetadata] = Field(
        default_factory=list,
        max_length=MAX_DRAFT_EXTRACTION_PAGES,
    )


class ParseDraft(BaseModel):
    document_type: str
    source_language: str | None = None
    parser_version: str
    raw_text: str = Field(default="", max_length=MAX_DRAFT_RAW_TEXT_CHARS)
    candidates: list[ClinicalCandidate] = Field(default_factory=list, max_length=MAX_DRAFT_CANDIDATES)
    warnings: list[str] = Field(default_factory=list)
    extraction: DraftExtractionMetadata | None = None
