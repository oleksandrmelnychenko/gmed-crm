from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from io import BytesIO
import logging
import math
import os
import re
import threading
import time
import unicodedata
import warnings
from typing import Any, Literal


MIN_USEFUL_TEXT_CHARS = 100
MAX_FILE_BYTES = int(os.environ.get("PARSER_MAX_FILE_BYTES", str(25 * 1024 * 1024)))
MAX_PDF_PAGES = int(os.environ.get("PARSER_MAX_PDF_PAGES", "80"))
MAX_IMAGE_PIXELS = int(os.environ.get("PARSER_MAX_IMAGE_PIXELS", "50000000"))
MAX_EXTRACTED_TEXT_CHARS = int(os.environ.get("PARSER_MAX_EXTRACTED_TEXT_CHARS", "500000"))
PDF_RENDER_SCALE = float(os.environ.get("PARSER_PDF_RENDER_SCALE", "2.5"))

# Keep OCR bounded. The document deadline prevents a pathological multi-page
# scan from multiplying the per-Tesseract timeout by MAX_PDF_PAGES.
OCR_PAGE_TIMEOUT_SECONDS = float(os.environ.get("PARSER_OCR_PAGE_TIMEOUT_SECONDS", "30"))
OCR_DOCUMENT_TIMEOUT_SECONDS = float(os.environ.get("PARSER_OCR_DOCUMENT_TIMEOUT_SECONDS", "180"))
OCR_OSD_TIMEOUT_SECONDS = float(os.environ.get("PARSER_OCR_OSD_TIMEOUT_SECONDS", "8"))
OCR_MIN_ORIENTATION_CONFIDENCE = float(
    os.environ.get("PARSER_OCR_MIN_ORIENTATION_CONFIDENCE", "5")
)
OCR_PRIMARY_LANGUAGES = os.environ.get("PARSER_OCR_PRIMARY_LANGUAGES", "deu+eng")
OCR_CYRILLIC_LANGUAGES = os.environ.get(
    "PARSER_OCR_CYRILLIC_LANGUAGES", "deu+eng+rus+ukr"
)
OCR_UKRAINIAN_LANGUAGES = os.environ.get(
    "PARSER_OCR_UKRAINIAN_LANGUAGES", "deu+eng+ukr"
)
OCR_RUSSIAN_LANGUAGES = os.environ.get(
    "PARSER_OCR_RUSSIAN_LANGUAGES", "deu+eng+rus"
)
# Backwards-compatible name for deployments which introspect this module.
OCR_LANGUAGES = OCR_CYRILLIC_LANGUAGES
OCR_LOW_CONFIDENCE_THRESHOLD = float(
    os.environ.get("PARSER_OCR_LOW_CONFIDENCE_THRESHOLD", "63")
)
OCR_MIN_IMAGE_DIMENSION = int(os.environ.get("PARSER_OCR_MIN_IMAGE_DIMENSION", "1000"))
SCAN_SPARSE_TEXT_CHARS = int(os.environ.get("PARSER_SCAN_SPARSE_TEXT_CHARS", "240"))
OCR_DESKEW_ENABLED = os.environ.get("PARSER_OCR_DESKEW", "true").lower() not in {
    "0",
    "false",
    "no",
}
OCR_MULTIPASS_ENABLED = os.environ.get("PARSER_OCR_MULTIPASS", "true").lower() not in {
    "0",
    "false",
    "no",
}
_configured_ocr_engine = os.environ.get("PARSER_OCR_ENGINE", "paddle").strip().lower()
OCR_ENGINE = (
    _configured_ocr_engine
    if _configured_ocr_engine in {"paddle", "tesseract"}
    else "paddle"
)
PADDLE_DETECTION_MODEL = "PP-OCRv5_mobile_det"
PADDLE_RECOGNITION_MODEL = "latin_PP-OCRv5_mobile_rec"
PADDLE_DETECTION_SIDE_LENGTH = 1280
PADDLE_CPU_THREADS = int(os.environ.get("PARSER_PADDLE_CPU_THREADS", "4"))
PADDLE_FAILURE_THRESHOLD = int(
    os.environ.get("PARSER_PADDLE_FAILURE_THRESHOLD", "2")
)
PADDLE_COOLDOWN_SECONDS = float(
    os.environ.get("PARSER_PADDLE_COOLDOWN_SECONDS", "60")
)
PADDLE_ISOLATE_PROCESS = os.environ.get(
    "PARSER_PADDLE_ISOLATE_PROCESS", "true"
).lower() not in {"0", "false", "no"}

_PADDLE_OCR: Any | None = None
_PADDLE_OCR_INIT_FAILED = False
_PADDLE_OCR_LOCK = threading.Lock()
_PADDLE_INFERENCE_LOCK = threading.Lock()
_PADDLE_RUNTIME: Any | None = None
_PADDLE_RUNTIME_LOCK = threading.Lock()

LOGGER = logging.getLogger("gmed.clinical_document_parser.extraction")

_WORD_PATTERN = re.compile(r"[^\W\d_]{2,}", re.UNICODE)
_CYRILLIC_PATTERN = re.compile(r"[\u0400-\u052f]")
_UKRAINIAN_DISTINCTIVE_PATTERN = re.compile(r"[іїєґІЇЄҐ]")
_RUSSIAN_DISTINCTIVE_PATTERN = re.compile(r"[ыэёъЫЭЁЪ]")
_OSD_ROTATE_PATTERN = re.compile(r"^Rotate:\s*(\d+)", re.MULTILINE)
_OSD_ORIENTATION_CONF_PATTERN = re.compile(
    r"^Orientation confidence:\s*([\d.]+)", re.MULTILINE
)
_OSD_SCRIPT_PATTERN = re.compile(r"^Script:\s*([^\r\n]+)", re.MULTILINE)


@dataclass(frozen=True, slots=True)
class OcrBlockMetadata:
    """Location and confidence for one OCR block, without duplicating PHI text."""

    block_number: int
    bbox: tuple[int, int, int, int]
    start_char: int
    end_char: int
    confidence: float | None
    word_count: int


@dataclass(frozen=True, slots=True)
class PageExtractionMetadata:
    page_number: int | None
    source: Literal["native", "ocr", "native_fallback", "existing", "text"]
    route_reason: str
    native_quality: float | None
    native_char_count: int
    ocr_confidence: float | None = None
    low_confidence_word_ratio: float | None = None
    ocr_languages: str | None = None
    ocr_engine: str | None = None
    orientation_rotation: int = 0
    deskew_angle: float = 0.0
    word_count: int = 0
    blocks: tuple[OcrBlockMetadata, ...] = ()


@dataclass(frozen=True, slots=True)
class ExtractionMetadata:
    page_count: int
    text_chars: int
    used_ocr: bool
    pages: tuple[PageExtractionMetadata, ...]


@dataclass(frozen=True, slots=True)
class ExtractionResult:
    text: str
    metadata: ExtractionMetadata


@dataclass(frozen=True, slots=True)
class _TextQuality:
    score: float
    reliable: bool
    char_count: int
    word_count: int
    reason: str


@dataclass(frozen=True, slots=True)
class _OcrOutcome:
    text: str
    confidence: float | None
    low_confidence_word_ratio: float | None
    languages: str
    engine: Literal["paddle", "tesseract"]
    word_count: int
    blocks: tuple[OcrBlockMetadata, ...]
    text_quality: _TextQuality
    rotation: int = 0
    deskew_angle: float = 0.0
    timed_out: bool = False

    @property
    def combined_quality(self) -> float:
        if self.confidence is None:
            return self.text_quality.score
        return 0.65 * max(0.0, min(1.0, self.confidence / 100.0)) + 0.35 * self.text_quality.score


class _PdfPageLimitExceeded(ValueError):
    pass


class _ImagePixelLimitExceeded(ValueError):
    pass


class _ExtractedTextLimitExceeded(ValueError):
    pass


def extract_text(data: bytes, mime_type: str | None, existing_text: str | None = None) -> str:
    """Return text using the historical string-only API."""

    return extract_document(data, mime_type, existing_text).text


def extract_document(
    data: bytes, mime_type: str | None, existing_text: str | None = None
) -> ExtractionResult:
    """Extract text plus routing and confidence metadata.

    Existing callers can continue using :func:`extract_text`. The richer API
    intentionally contains only aggregate OCR evidence and character offsets,
    not another copy of the medical text.
    """

    if len(data) > MAX_FILE_BYTES:
        raise ValueError("Document exceeds the parser size limit")
    mime = (mime_type or "").lower()
    is_pdf = "pdf" in mime or data.startswith(b"%PDF")

    if existing_text:
        candidate = existing_text.strip()
        quality = _assess_text_quality(candidate)
        if quality.reliable:
            page_count = _validate_pdf_page_count(data) if is_pdf else 1
            text = _checked_extracted_text(candidate)
            return _make_result(
                text,
                page_count,
                (
                    PageExtractionMetadata(
                        page_number=None if is_pdf and page_count != 1 else 1,
                        source="existing",
                        route_reason="existing_text_passed_quality_checks",
                        native_quality=quality.score,
                        native_char_count=quality.char_count,
                        word_count=quality.word_count,
                    ),
                ),
            )

    if is_pdf:
        return _extract_pdf(data)
    if mime.startswith("image/"):
        outcome = _ocr_image(data, time.monotonic() + OCR_DOCUMENT_TIMEOUT_SECONDS)
        text = _checked_extracted_text(outcome.text)
        return _make_result(text, 1, (_metadata_for_ocr(1, "image_document", "", outcome),))
    try:
        text = _checked_extracted_text(data.decode("utf-8").strip())
    except UnicodeDecodeError as exc:
        raise ValueError("Unsupported document format") from exc
    quality = _assess_text_quality(text)
    return _make_result(
        text,
        1,
        (
            PageExtractionMetadata(
                page_number=1,
                source="text",
                route_reason="decoded_utf8_text",
                native_quality=quality.score,
                native_char_count=quality.char_count,
                word_count=quality.word_count,
            ),
        ),
    )


def _extract_pdf(data: bytes) -> ExtractionResult:
    from pypdf import PdfReader

    native_pages: list[str] | None = None
    native_qualities: list[_TextQuality] | None = None
    scan_image_hints: list[bool] | None = None
    try:
        # pypdf is deliberately lenient here. Some scanner-produced PDFs emit
        # recoverable warnings or contain one malformed text layer even though
        # their raster page can still be rendered and OCRed locally.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            reader = PdfReader(BytesIO(data), strict=False)
            page_count = len(reader.pages)
        _check_pdf_page_limit(page_count)
        native_pages = []
        native_qualities = []
        scan_image_hints = []
        native_chars = 0
        for page_number in range(page_count):
            page = reader.pages[page_number]
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    text = _extract_native_page_text(page)
            except Exception:
                text = ""
            native_chars += len(text)
            _check_extracted_text_limit(native_chars)
            native_pages.append(text)
            native_qualities.append(_assess_text_quality(text))
            scan_image_hints.append(_page_has_scan_like_image(page))
    except (_PdfPageLimitExceeded, _ExtractedTextLimitExceeded):
        raise
    except Exception:
        # If the PDF cross-reference or text layer is malformed, PDFium may
        # still be able to render the pages. No document bytes leave the host.
        native_pages = None
        native_qualities = None
        scan_image_hints = None

    if native_pages is not None and native_qualities is not None:
        reliable = [
            quality.reliable
            and not (scan_hint and quality.char_count < SCAN_SPARSE_TEXT_CHARS)
            for quality, scan_hint in zip(native_qualities, scan_image_hints or [], strict=True)
        ]
        if all(reliable):
            text = _join_pdf_pages(native_pages)
            pages = tuple(
                PageExtractionMetadata(
                    page_number=index + 1,
                    source="native",
                    route_reason="native_text_passed_quality_checks",
                    native_quality=quality.score,
                    native_char_count=quality.char_count,
                    word_count=quality.word_count,
                )
                for index, quality in enumerate(native_qualities)
            )
            return _make_result(text, len(native_pages), pages)

    return _ocr_weak_pdf_pages(data, native_pages, native_qualities, scan_image_hints)


def _extract_native_page_text(page: object) -> str:
    extract = getattr(page, "extract_text")
    try:
        # pypdf's layout mode retains columns and line boundaries better than
        # its legacy plain extraction. Compare both modes so a rotated or
        # unusual content stream cannot silently lose native glyphs.
        layout_text = _normalize_extracted_text(extract(extraction_mode="layout") or "")
    except TypeError:
        return _normalize_extracted_text(extract() or "")
    except Exception:
        layout_text = ""

    try:
        legacy_text = _normalize_extracted_text(extract() or "")
    except Exception:
        return layout_text
    if not layout_text:
        return legacy_text
    layout_visible = _visible_character_count(layout_text)
    legacy_visible = _visible_character_count(legacy_text)
    if layout_visible >= legacy_visible * 0.98:
        return layout_text
    return legacy_text


def _validate_pdf_page_count(data: bytes) -> int:
    from pypdf import PdfReader

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            reader = PdfReader(BytesIO(data), strict=False)
            page_count = len(reader.pages)
        _check_pdf_page_limit(page_count)
        return page_count
    except _PdfPageLimitExceeded:
        raise
    except Exception:
        pass

    import pypdfium2 as pdfium

    pdf = None
    try:
        pdf = pdfium.PdfDocument(data)
        page_count = len(pdf)
        _check_pdf_page_limit(page_count)
        return page_count
    except _PdfPageLimitExceeded:
        raise
    except Exception as exc:
        raise ValueError("Unable to validate PDF page count") from exc
    finally:
        _close_resource(pdf)


def _ocr_weak_pdf_pages(
    data: bytes,
    native_pages: list[str] | None,
    native_qualities: list[_TextQuality] | None,
    scan_image_hints: list[bool] | None,
) -> ExtractionResult:
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(data)
        page_count = len(pdf)
    except Exception:
        # Preserve whatever pypdf could recover instead of failing the entire
        # mixed document because one weak page could not be rendered.
        recovered = native_pages or []
        text = _join_pdf_pages(recovered)
        pages = tuple(
            _native_fallback_metadata(index + 1, page_text, "pdf_render_failed")
            for index, page_text in enumerate(recovered)
        )
        if not pages:
            pages = (_native_fallback_metadata(None, "", "pdf_render_failed"),)
        return _make_result(text, len(recovered), pages)

    extracted_pages: list[str] = []
    page_metadata: list[PageExtractionMetadata] = []
    extracted_chars = 0
    deadline = time.monotonic() + OCR_DOCUMENT_TIMEOUT_SECONDS
    try:
        _check_pdf_page_limit(page_count)
        for page_number in range(page_count):
            native_text = (
                native_pages[page_number]
                if native_pages and page_number < len(native_pages)
                else ""
            )
            native_quality = (
                native_qualities[page_number]
                if native_qualities and page_number < len(native_qualities)
                else _assess_text_quality(native_text)
            )
            scan_hint = bool(
                scan_image_hints
                and page_number < len(scan_image_hints)
                and scan_image_hints[page_number]
            )
            if native_quality.reliable and not (
                scan_hint and native_quality.char_count < SCAN_SPARSE_TEXT_CHARS
            ):
                extracted_chars += len(native_text)
                _check_extracted_text_limit(extracted_chars)
                extracted_pages.append(native_text)
                page_metadata.append(
                    PageExtractionMetadata(
                        page_number=page_number + 1,
                        source="native",
                        route_reason="native_text_passed_quality_checks",
                        native_quality=native_quality.score,
                        native_char_count=native_quality.char_count,
                        word_count=native_quality.word_count,
                    )
                )
                continue

            outcome: _OcrOutcome | None = None
            page = None
            bitmap = None
            image = None
            route_reason = (
                "scan_like_page_with_sparse_text_layer"
                if scan_hint and native_quality.char_count < SCAN_SPARSE_TEXT_CHARS
                else native_quality.reason
            )
            try:
                if time.monotonic() >= deadline:
                    route_reason = "document_ocr_deadline_exhausted"
                else:
                    page = pdf[page_number]
                    _check_rendered_page_size(page)
                    bitmap = page.render(scale=PDF_RENDER_SCALE)
                    image = bitmap.to_pil()
                    _check_image_size(image.width, image.height)
                    outcome = _ocr_pil_image(image, deadline, native_text)
            except _ImagePixelLimitExceeded:
                raise
            except Exception:
                # A short native fragment is still more useful than dropping
                # the page when only its OCR path is malformed.
                outcome = None
                route_reason = "ocr_failed_native_fragment_preserved"
            finally:
                _close_resource(image)
                _close_resource(bitmap)
                _close_resource(page)

            if outcome is not None and _prefer_ocr(native_quality, outcome):
                page_text = outcome.text
                page_metadata.append(
                    _metadata_for_ocr(page_number + 1, route_reason, native_text, outcome)
                )
            else:
                page_text = native_text
                if route_reason == "document_ocr_deadline_exhausted":
                    fallback_reason = route_reason
                elif outcome is not None and outcome.timed_out:
                    fallback_reason = "ocr_timeout_native_fragment_preserved"
                elif route_reason == "ocr_failed_native_fragment_preserved":
                    fallback_reason = route_reason
                else:
                    fallback_reason = "ocr_not_better_native_fragment_preserved"
                page_metadata.append(
                    PageExtractionMetadata(
                        page_number=page_number + 1,
                        source="native_fallback",
                        route_reason=fallback_reason,
                        native_quality=native_quality.score,
                        native_char_count=native_quality.char_count,
                        ocr_confidence=outcome.confidence if outcome else None,
                        low_confidence_word_ratio=(
                            outcome.low_confidence_word_ratio if outcome else None
                        ),
                        ocr_languages=outcome.languages if outcome else None,
                        ocr_engine=outcome.engine if outcome else None,
                        orientation_rotation=outcome.rotation if outcome else 0,
                        deskew_angle=outcome.deskew_angle if outcome else 0.0,
                        word_count=native_quality.word_count,
                    )
                )
            extracted_chars += len(page_text)
            _check_extracted_text_limit(extracted_chars)
            extracted_pages.append(page_text)
    finally:
        _close_resource(pdf)

    # A malformed parser may disagree with PDFium about the page count. Keep
    # any additional native pages that were still recovered by pypdf.
    if native_pages and len(native_pages) > page_count:
        for index, page_text in enumerate(native_pages[page_count:], start=page_count + 1):
            extracted_chars += len(page_text)
            _check_extracted_text_limit(extracted_chars)
            extracted_pages.append(page_text)
            page_metadata.append(
                _native_fallback_metadata(index, page_text, "pdf_page_count_disagreement")
            )
    text = _join_pdf_pages(extracted_pages)
    return _make_result(text, max(page_count, len(extracted_pages)), tuple(page_metadata))


def _ocr_image(data: bytes, deadline: float) -> _OcrOutcome:
    from PIL import Image

    image = Image.open(BytesIO(data))
    try:
        _check_image_size(image.width, image.height)
        return _ocr_pil_image(image, deadline, "")
    finally:
        image.close()


def _ocr_pil_image(image: object, deadline: float, text_hint: str) -> _OcrOutcome:
    prepared = None
    oriented = None
    deskewed = None
    thresholded = None
    table_cleaned = None
    table_layout_selected = False
    try:
        page_deadline = min(deadline, time.monotonic() + OCR_PAGE_TIMEOUT_SECONDS)
        try:
            prepared = _prepare_image(image)
        except Exception:
            # Test doubles and unusual Pillow modes can still be processed by
            # Tesseract directly; preprocessing is an accuracy enhancement.
            prepared = image

        rotation, script = _detect_orientation(prepared, page_deadline)
        oriented = prepared
        if rotation:
            try:
                candidate = prepared.rotate(  # type: ignore[attr-defined]
                    -rotation, expand=True, fillcolor=255
                )
                _check_image_size(candidate.width, candidate.height)
                oriented = candidate
            except Exception:
                oriented = prepared
                rotation = 0

        deskew_angle = 0.0
        deskewed = oriented
        if OCR_DESKEW_ENABLED:
            try:
                deskew_angle = _estimate_skew_angle(oriented)
                if deskew_angle:
                    candidate = oriented.rotate(  # type: ignore[attr-defined]
                        deskew_angle, expand=True, fillcolor=255
                    )
                    _check_image_size(candidate.width, candidate.height)
                    deskewed = candidate
            except Exception:
                deskewed = oriented
                deskew_angle = 0.0

        primary_languages = _select_ocr_languages(text_hint, script)
        primary = _run_ocr_engine(deskewed, primary_languages, page_deadline)
        primary = _replace_ocr_geometry(primary, rotation, deskew_angle)

        if (
            OCR_MULTIPASS_ENABLED
            and primary.engine == "tesseract"
            and time.monotonic() < page_deadline
        ):
            try:
                table_cleaned, removed_rule_count = _remove_table_rules(deskewed)
                if removed_rule_count >= 4:
                    table_outcome = _run_tesseract(
                        table_cleaned,
                        primary_languages,
                        page_deadline,
                    )
                    table_outcome = _replace_ocr_geometry(
                        table_outcome, rotation, deskew_angle
                    )
                    primary_table_score = (
                        primary.word_count + primary.text.count("\t") * 2
                    )
                    alternate_table_score = (
                        table_outcome.word_count + table_outcome.text.count("\t") * 2
                    )
                    if (
                        alternate_table_score > primary_table_score * 1.15
                        and table_outcome.combined_quality
                        >= primary.combined_quality - 0.12
                    ):
                        primary = table_outcome
                        table_layout_selected = True
            except Exception:
                LOGGER.warning("Ruled-table OCR preprocessing failed", exc_info=False)

        if (
            OCR_MULTIPASS_ENABLED
            and not table_layout_selected
            and _should_retry_preprocessing(primary)
            and time.monotonic() < page_deadline
        ):
            try:
                thresholded = _binarize_image(deskewed)
                alternate = _run_ocr_engine(
                    thresholded, primary_languages, page_deadline
                )
                alternate = _replace_ocr_geometry(alternate, rotation, deskew_angle)
                if alternate.combined_quality > primary.combined_quality + 0.01:
                    primary = alternate
            except Exception:
                LOGGER.warning("Alternate OCR preprocessing failed", exc_info=False)

        if (
            not _languages_include_cyrillic(primary_languages)
            and _should_try_cyrillic_fallback(primary)
            and time.monotonic() < page_deadline
        ):
            fallback = _run_ocr_engine(
                deskewed, OCR_CYRILLIC_LANGUAGES, page_deadline
            )
            fallback = _replace_ocr_geometry(fallback, rotation, deskew_angle)
            if fallback.combined_quality > primary.combined_quality + 0.02:
                return fallback
        return primary
    finally:
        closed_resources: set[int] = set()
        for resource in (table_cleaned, thresholded, deskewed, oriented, prepared):
            if resource is None or resource is image or id(resource) in closed_resources:
                continue
            closed_resources.add(id(resource))
            _close_resource(resource)


def _prepare_image(image: object) -> object:
    from PIL import Image, ImageOps

    transposed = ImageOps.exif_transpose(image)  # type: ignore[arg-type]
    try:
        prepared = ImageOps.grayscale(transposed)
    finally:
        if transposed is not image:
            transposed.close()
    try:
        contrasted = ImageOps.autocontrast(prepared, cutoff=1)
    finally:
        prepared.close()
    prepared = contrasted

    width, height = prepared.size
    short_edge = min(width, height)
    if 0 < short_edge < OCR_MIN_IMAGE_DIMENSION:
        scale = min(2.0, OCR_MIN_IMAGE_DIMENSION / short_edge)
        target = (max(1, round(width * scale)), max(1, round(height * scale)))
        if target[0] * target[1] <= MAX_IMAGE_PIXELS:
            resized = prepared.resize(target, Image.Resampling.LANCZOS)
            prepared.close()
            prepared = resized
    _check_image_size(prepared.width, prepared.height)
    return prepared


def _binarize_image(image: object) -> object:
    from PIL import ImageOps

    grayscale = ImageOps.grayscale(image)  # type: ignore[arg-type]
    try:
        histogram = grayscale.histogram()
        total = sum(histogram)
        weighted_sum = sum(index * count for index, count in enumerate(histogram))
        background_weight = 0
        background_sum = 0.0
        best_variance = -1.0
        threshold = 180
        for value, count in enumerate(histogram):
            background_weight += count
            if background_weight == 0:
                continue
            foreground_weight = total - background_weight
            if foreground_weight == 0:
                break
            background_sum += value * count
            background_mean = background_sum / background_weight
            foreground_mean = (weighted_sum - background_sum) / foreground_weight
            variance = background_weight * foreground_weight * (
                background_mean - foreground_mean
            ) ** 2
            if variance > best_variance:
                best_variance = variance
                threshold = value
        return grayscale.point(lambda pixel: 255 if pixel > threshold else 0)
    finally:
        grayscale.close()


def _remove_table_rules(image: object) -> tuple[object, int]:
    """Remove long table borders while preserving text and short glyph strokes.

    Scanned laboratory forms often contain continuous horizontal and vertical
    rules. Tesseract otherwise treats the bordered cells as separate graphics
    and can omit the value column entirely. The thresholds deliberately target
    only lines spanning a substantial part of the page.
    """

    from PIL import ImageDraw, ImageOps

    grayscale = ImageOps.grayscale(image)  # type: ignore[arg-type]
    cleaned = grayscale.copy()
    try:
        width, height = grayscale.size
        pixels = grayscale.load()
        if width < 1 or height < 1 or pixels is None:
            return cleaned, 0

        dark_threshold = 180
        horizontal_min = max(1, round(width * 0.35))
        vertical_min = max(1, round(height * 0.35))
        horizontal_rows = [
            y
            for y in range(height)
            if sum(1 for x in range(width) if pixels[x, y] < dark_threshold)
            >= horizontal_min
        ]
        vertical_columns = [
            x
            for x in range(width)
            if sum(1 for y in range(height) if pixels[x, y] < dark_threshold)
            >= vertical_min
        ]

        draw = ImageDraw.Draw(cleaned)
        for y in horizontal_rows:
            draw.line((0, y, width - 1, y), fill=255, width=3)
        for x in vertical_columns:
            draw.line((x, 0, x, height - 1), fill=255, width=3)
        return cleaned, len(horizontal_rows) + len(vertical_columns)
    finally:
        grayscale.close()


def _detect_orientation(image: object, deadline: float) -> tuple[int, str | None]:
    import pytesseract

    image_to_osd = getattr(pytesseract, "image_to_osd", None)
    if not callable(image_to_osd):
        return 0, None
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return 0, None
    timeout = min(OCR_OSD_TIMEOUT_SECONDS, remaining)
    try:
        output = image_to_osd(image, timeout=timeout)
    except (RuntimeError, TypeError, ValueError):
        return 0, None
    rotate_match = _OSD_ROTATE_PATTERN.search(str(output))
    confidence_match = _OSD_ORIENTATION_CONF_PATTERN.search(str(output))
    script_match = _OSD_SCRIPT_PATTERN.search(str(output))
    rotation = int(rotate_match.group(1)) % 360 if rotate_match else 0
    confidence = float(confidence_match.group(1)) if confidence_match else 0.0
    if (
        rotation not in {0, 90, 180, 270}
        or confidence < OCR_MIN_ORIENTATION_CONFIDENCE
    ):
        rotation = 0
    script = script_match.group(1).strip() if script_match else None
    return rotation, script


def _estimate_skew_angle(image: object) -> float:
    """Estimate a small skew using horizontal-projection sharpness.

    Work happens on a <=900 px thumbnail, so memory and CPU do not scale with
    the source scan. Only a material score improvement is applied.
    """

    from PIL import ImageOps

    sample = ImageOps.grayscale(image)  # type: ignore[arg-type]
    try:
        sample.thumbnail((900, 900))
        try:
            contrasted = ImageOps.autocontrast(sample, cutoff=1)
        finally:
            sample.close()
        sample = contrasted
        ink = sample.point(lambda pixel: 255 if pixel < 190 else 0)
        try:
            histogram = ink.histogram()
            ink_pixels = sum(histogram[1:])
            pixel_count = max(1, ink.width * ink.height)
            ink_ratio = ink_pixels / pixel_count
            if not 0.003 <= ink_ratio <= 0.45:
                return 0.0

            scores: dict[float, float] = {}
            for angle in (-3.0, -2.0, -1.0, 0.0, 1.0, 2.0, 3.0):
                scores[angle] = _projection_score(ink, angle)
            best = max(scores, key=scores.get)
            baseline = max(1.0, scores[0.0])
            if best == 0.0 or scores[best] < baseline * 1.025:
                return 0.0
            return best
        finally:
            ink.close()
    finally:
        sample.close()


def _projection_score(image: object, angle: float) -> float:
    from PIL import Image

    rotated = image.rotate(angle, expand=False, fillcolor=0)  # type: ignore[attr-defined]
    try:
        # BOX downsampling to one pixel of width is a bounded row-sum proxy.
        # PIL's getprojection() only indicates whether a row is non-empty and
        # therefore cannot distinguish aligned text baselines from skew.
        profile = rotated.resize((1, rotated.height), Image.Resampling.BOX)
        try:
            vertical = list(profile.tobytes())
        finally:
            profile.close()
        if not vertical:
            return 0.0
        mean = sum(vertical) / len(vertical)
        return sum((value - mean) ** 2 for value in vertical)
    finally:
        rotated.close()


def _select_ocr_languages(text_hint: str, script: str | None) -> str:
    if _UKRAINIAN_DISTINCTIVE_PATTERN.search(text_hint):
        return OCR_UKRAINIAN_LANGUAGES
    if _RUSSIAN_DISTINCTIVE_PATTERN.search(text_hint):
        return OCR_RUSSIAN_LANGUAGES
    if _CYRILLIC_PATTERN.search(text_hint):
        return OCR_CYRILLIC_LANGUAGES
    if script and "cyrillic" in script.casefold():
        return OCR_CYRILLIC_LANGUAGES
    return OCR_PRIMARY_LANGUAGES


def _languages_include_cyrillic(languages: str) -> bool:
    configured = set(languages.casefold().split("+"))
    return bool(configured & {"rus", "ukr", "bel", "bul", "srp", "mkd"})


def _run_ocr_engine(image: object, languages: str, deadline: float) -> _OcrOutcome:
    # The configured Paddle recognition model is Latin-only. Cyrillic pages
    # retain the existing local Tesseract language route.
    if OCR_ENGINE == "paddle" and not _languages_include_cyrillic(languages):
        try:
            paddle_outcome = _run_paddle(image, deadline)
            if paddle_outcome.text.strip():
                return paddle_outcome
        except Exception as exc:
            # Model import, initialization, download, and inference failures
            # are page-local. Tesseract remains the deterministic fallback.
            LOGGER.warning("Paddle OCR failed; using Tesseract (%s)", type(exc).__name__)
    return _run_tesseract(image, languages, deadline)


def _get_paddle_ocr() -> object:
    global _PADDLE_OCR, _PADDLE_OCR_INIT_FAILED

    if _PADDLE_OCR is not None:
        return _PADDLE_OCR
    if _PADDLE_OCR_INIT_FAILED:
        raise RuntimeError("PaddleOCR initialization previously failed")
    with _PADDLE_OCR_LOCK:
        if _PADDLE_OCR is not None:
            return _PADDLE_OCR
        if _PADDLE_OCR_INIT_FAILED:
            raise RuntimeError("PaddleOCR initialization previously failed")
        try:
            from paddleocr import PaddleOCR

            _PADDLE_OCR = PaddleOCR(
                text_detection_model_name=PADDLE_DETECTION_MODEL,
                text_recognition_model_name=PADDLE_RECOGNITION_MODEL,
                use_doc_orientation_classify=True,
                use_doc_unwarping=True,
                use_textline_orientation=True,
                text_det_limit_side_len=PADDLE_DETECTION_SIDE_LENGTH,
                text_det_limit_type="max",
                device="cpu",
                enable_mkldnn=False,
                cpu_threads=max(1, PADDLE_CPU_THREADS),
            )
        except Exception:
            _PADDLE_OCR_INIT_FAILED = True
            raise
        return _PADDLE_OCR


def _get_paddle_runtime() -> object:
    global _PADDLE_RUNTIME

    if _PADDLE_RUNTIME is not None:
        return _PADDLE_RUNTIME
    with _PADDLE_RUNTIME_LOCK:
        if _PADDLE_RUNTIME is None:
            from .paddle_runtime import PaddleProcessRuntime, PaddleRuntimeOptions

            _PADDLE_RUNTIME = PaddleProcessRuntime(
                PaddleRuntimeOptions(
                    detection_model=PADDLE_DETECTION_MODEL,
                    recognition_model=PADDLE_RECOGNITION_MODEL,
                    detection_side_length=PADDLE_DETECTION_SIDE_LENGTH,
                    cpu_threads=PADDLE_CPU_THREADS,
                ),
                failure_threshold=PADDLE_FAILURE_THRESHOLD,
                cooldown_seconds=PADDLE_COOLDOWN_SECONDS,
            )
        return _PADDLE_RUNTIME


def _run_paddle(image: object, deadline: float) -> _OcrOutcome:
    remaining = min(OCR_PAGE_TIMEOUT_SECONDS, deadline - time.monotonic())
    if remaining <= 0:
        return _empty_ocr_outcome("latin", engine="paddle", timed_out=True)
    acquired = _PADDLE_INFERENCE_LOCK.acquire(timeout=remaining)
    if not acquired:
        return _empty_ocr_outcome("latin", engine="paddle", timed_out=True)

    try:
        paddle_input = _paddle_image_array(image)
        call_deadline = min(deadline, time.monotonic() + OCR_PAGE_TIMEOUT_SECONDS)
        if PADDLE_ISOLATE_PROCESS:
            runtime = _get_paddle_runtime()
            results = runtime.predict(  # type: ignore[attr-defined]
                paddle_input, max(0.0, call_deadline - time.monotonic())
            )
        else:
            pipeline = _get_paddle_ocr()
            results = pipeline.predict(  # type: ignore[attr-defined]
                paddle_input,
                text_det_limit_side_len=PADDLE_DETECTION_SIDE_LENGTH,
                text_det_limit_type="max",
            )
        outcome = _outcome_from_paddle_results(results)
        if time.monotonic() > call_deadline:
            return _empty_ocr_outcome("latin", engine="paddle", timed_out=True)
        return _scale_paddle_outcome(outcome, image, paddle_input)
    except TimeoutError:
        LOGGER.warning("Paddle OCR exceeded its page deadline")
        return _empty_ocr_outcome("latin", engine="paddle", timed_out=True)
    finally:
        _PADDLE_INFERENCE_LOCK.release()


def _scale_paddle_outcome(
    outcome: _OcrOutcome, source_image: object, paddle_input: object
) -> _OcrOutcome:
    source_size = getattr(source_image, "size", None)
    input_shape = getattr(paddle_input, "shape", None)
    if (
        not isinstance(source_size, tuple)
        or len(source_size) != 2
        or not isinstance(input_shape, tuple)
        or len(input_shape) < 2
        or not input_shape[0]
        or not input_shape[1]
    ):
        return outcome
    scale_x = float(source_size[0]) / float(input_shape[1])
    scale_y = float(source_size[1]) / float(input_shape[0])
    if abs(scale_x - 1.0) < 0.001 and abs(scale_y - 1.0) < 0.001:
        return outcome
    blocks = tuple(
        OcrBlockMetadata(
            block_number=block.block_number,
            bbox=(
                round(block.bbox[0] * scale_x),
                round(block.bbox[1] * scale_y),
                round(block.bbox[2] * scale_x),
                round(block.bbox[3] * scale_y),
            ),
            start_char=block.start_char,
            end_char=block.end_char,
            confidence=block.confidence,
            word_count=block.word_count,
        )
        for block in outcome.blocks
    )
    return _OcrOutcome(
        text=outcome.text,
        confidence=outcome.confidence,
        low_confidence_word_ratio=outcome.low_confidence_word_ratio,
        languages=outcome.languages,
        engine=outcome.engine,
        word_count=outcome.word_count,
        blocks=blocks,
        text_quality=outcome.text_quality,
        rotation=outcome.rotation,
        deskew_angle=outcome.deskew_angle,
        timed_out=outcome.timed_out,
    )


def _paddle_image_array(image: object) -> object:
    import numpy as np
    from PIL import Image

    convert = getattr(image, "convert", None)
    converted = convert("RGB") if callable(convert) else image
    try:
        size = getattr(converted, "size", None)
        if (
            isinstance(size, tuple)
            and len(size) == 2
            and max(size) > PADDLE_DETECTION_SIDE_LENGTH
        ):
            scale = PADDLE_DETECTION_SIDE_LENGTH / max(size)
            target = (max(1, round(size[0] * scale)), max(1, round(size[1] * scale)))
            resized = converted.resize(  # type: ignore[attr-defined]
                target, Image.Resampling.LANCZOS
            )
            if converted is not image:
                _close_resource(converted)
            converted = resized
        return np.asarray(converted).copy()
    finally:
        if converted is not image:
            _close_resource(converted)


def _outcome_from_paddle_results(results: object) -> _OcrOutcome:
    rows: list[dict[str, Any]] = []
    iterable = _as_sequence(results)
    for result in iterable:
        payload = _paddle_result_payload(result)
        texts = _as_sequence(payload.get("rec_texts"))
        scores = _as_sequence(payload.get("rec_scores"))
        boxes = _as_sequence(payload.get("rec_boxes"))
        if not boxes:
            boxes = _as_sequence(payload.get("rec_polys"))
        for index, raw_text in enumerate(texts):
            text = str(raw_text or "").strip()
            if not text:
                continue
            confidence = (
                _normalize_ocr_confidence(scores[index]) if index < len(scores) else None
            )
            bbox = _paddle_bbox(boxes[index]) if index < len(boxes) else (0, 0, 0, 0)
            rows.append({"text": text, "confidence": confidence, "bbox": bbox})

    rows = _sort_paddle_rows(rows)

    output_parts: list[str] = []
    blocks: list[OcrBlockMetadata] = []
    confidence_weights: list[tuple[float, int]] = []
    low_confidence_words = 0
    total_words = 0
    cursor = 0
    previous_bbox: tuple[int, int, int, int] | None = None
    for block_number, row in enumerate(rows, start=1):
        bbox = row["bbox"]
        if output_parts:
            separator = _paddle_block_separator(previous_bbox, bbox)
            output_parts.append(separator)
            cursor += len(separator)
        start_char = cursor
        text = str(row["text"])
        output_parts.append(text)
        cursor += len(text)
        confidence = row["confidence"]
        word_count = max(1, len(_WORD_PATTERN.findall(text)))
        total_words += word_count
        if confidence is None:
            low_confidence_words += word_count
        else:
            confidence_weights.append((float(confidence), max(1, len(text))))
            if confidence < OCR_LOW_CONFIDENCE_THRESHOLD:
                low_confidence_words += word_count
        blocks.append(
            OcrBlockMetadata(
                block_number=block_number,
                bbox=bbox,
                start_char=start_char,
                end_char=cursor,
                confidence=confidence,
                word_count=word_count,
            )
        )
        previous_bbox = bbox

    text = "".join(output_parts).strip()
    quality = _assess_text_quality(text)
    return _OcrOutcome(
        text=text,
        confidence=_weighted_confidence(confidence_weights),
        low_confidence_word_ratio=(
            low_confidence_words / total_words
            if total_words else None
        ),
        languages="latin",
        engine="paddle",
        word_count=total_words,
        blocks=tuple(blocks),
        text_quality=quality,
    )


def _sort_paddle_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return stable reading order for tables and common two-column letters."""

    if len(rows) < 2 or any(row["bbox"] == (0, 0, 0, 0) for row in rows):
        return rows
    top_sorted = _row_major_order(rows)
    if len(rows) < 4:
        return top_sorted
    if _looks_like_table(top_sorted):
        return top_sorted

    left_edge = min(row["bbox"][0] for row in rows)
    right_edge = max(row["bbox"][0] + row["bbox"][2] for row in rows)
    page_span = max(1, right_edge - left_edge)
    narrow = [row for row in rows if row["bbox"][2] < page_span * 0.58]
    if len(narrow) < 4:
        return top_sorted

    centers = sorted(
        (row["bbox"][0] + row["bbox"][2] / 2, index)
        for index, row in enumerate(narrow)
    )
    gaps = [
        centers[index + 1][0] - centers[index][0]
        for index in range(len(centers) - 1)
    ]
    split_index = max(range(len(gaps)), key=gaps.__getitem__)
    if gaps[split_index] < page_span * 0.18:
        return top_sorted
    split = (centers[split_index][0] + centers[split_index + 1][0]) / 2
    left_column = [
        row for row in narrow if row["bbox"][0] + row["bbox"][2] / 2 <= split
    ]
    right_column = [
        row for row in narrow if row["bbox"][0] + row["bbox"][2] / 2 > split
    ]
    if len(left_column) < 2 or len(right_column) < 2:
        return top_sorted

    left_range = (
        min(row["bbox"][1] for row in left_column),
        max(row["bbox"][1] + row["bbox"][3] for row in left_column),
    )
    right_range = (
        min(row["bbox"][1] for row in right_column),
        max(row["bbox"][1] + row["bbox"][3] for row in right_column),
    )
    overlap = min(left_range[1], right_range[1]) - max(left_range[0], right_range[0])
    shorter_height = max(
        1,
        min(left_range[1] - left_range[0], right_range[1] - right_range[0]),
    )
    if overlap / shorter_height < 0.35:
        return top_sorted

    column_top = min(left_range[0], right_range[0])
    column_bottom = max(left_range[1], right_range[1])
    spanning = [row for row in rows if row not in narrow]
    if any(column_top < row["bbox"][1] < column_bottom for row in spanning):
        return top_sorted
    prefix = [row for row in spanning if row["bbox"][1] <= column_top]
    suffix = [row for row in spanning if row not in prefix]
    def sort_key(row: dict[str, Any]) -> tuple[int, int]:
        return (row["bbox"][1], row["bbox"][0])

    return (
        sorted(prefix, key=sort_key)
        + sorted(left_column, key=sort_key)
        + sorted(right_column, key=sort_key)
        + sorted(suffix, key=sort_key)
    )


def _looks_like_table(rows: list[dict[str, Any]]) -> bool:
    """Detect repeated numeric cells aligned on shared row baselines."""

    groups = _aligned_row_groups(rows)
    numeric_rows = 0
    for group in groups:
        if len(group) < 2:
            continue
        ordered = sorted(group, key=lambda row: row["bbox"][0])
        if any(re.search(r"(?<!\w)[<>]?\d+(?:[.,]\d+)?", str(row["text"])) for row in ordered[1:]):
            numeric_rows += 1
    return numeric_rows >= 3


def _row_major_order(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups = _aligned_row_groups(rows)
    groups.sort(key=lambda group: min(row["bbox"][1] for row in group))
    return [
        row
        for group in groups
        for row in sorted(group, key=lambda item: item["bbox"][0])
    ]


def _aligned_row_groups(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    groups: list[list[dict[str, Any]]] = []
    for row in sorted(rows, key=lambda item: item["bbox"][1]):
        top = row["bbox"][1]
        height = max(1, row["bbox"][3])
        center = top + height / 2
        matched: list[dict[str, Any]] | None = None
        for group in groups:
            group_row = group[0]
            group_height = max(1, group_row["bbox"][3])
            group_center = group_row["bbox"][1] + group_height / 2
            if abs(center - group_center) <= max(height, group_height) * 0.65:
                matched = group
                break
        if matched is None:
            groups.append([row])
        else:
            matched.append(row)
    return groups


def _paddle_result_payload(result: object) -> dict[str, Any]:
    if isinstance(result, dict):
        value: object = result
    else:
        value = getattr(result, "json", {})
        if callable(value):
            value = value()
    if not isinstance(value, dict):
        return {}
    nested = value.get("res", value)
    return nested if isinstance(nested, dict) else {}


def _as_sequence(value: object) -> list[Any]:
    if value is None:
        return []
    to_list = getattr(value, "tolist", None)
    if callable(to_list):
        value = to_list()
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, (str, bytes, dict)):
        return [value]
    try:
        return list(value)  # type: ignore[arg-type]
    except TypeError:
        return [value]


def _normalize_ocr_confidence(value: object) -> float | None:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(confidence):
        return None
    if 0.0 <= confidence <= 1.0:
        confidence *= 100.0
    return round(max(0.0, min(100.0, confidence)), 2)


def _paddle_bbox(value: object) -> tuple[int, int, int, int]:
    points = _as_sequence(value)
    if len(points) >= 4 and all(not isinstance(item, (list, tuple)) for item in points[:4]):
        try:
            left, top, right, bottom = (int(round(float(item))) for item in points[:4])
            return (left, top, max(0, right - left), max(0, bottom - top))
        except (TypeError, ValueError):
            return (0, 0, 0, 0)

    coordinates: list[tuple[float, float]] = []
    for point in points:
        pair = _as_sequence(point)
        if len(pair) < 2:
            continue
        try:
            coordinates.append((float(pair[0]), float(pair[1])))
        except (TypeError, ValueError):
            continue
    if not coordinates:
        return (0, 0, 0, 0)
    left = round(min(point[0] for point in coordinates))
    top = round(min(point[1] for point in coordinates))
    right = round(max(point[0] for point in coordinates))
    bottom = round(max(point[1] for point in coordinates))
    return (left, top, max(0, right - left), max(0, bottom - top))


def _paddle_block_separator(
    previous: tuple[int, int, int, int] | None,
    current: tuple[int, int, int, int],
) -> str:
    if previous is None or previous == (0, 0, 0, 0) or current == (0, 0, 0, 0):
        return "\n"
    previous_top, previous_height = previous[1], max(1, previous[3])
    current_top, current_height = current[1], max(1, current[3])
    vertical_overlap = min(
        previous_top + previous_height, current_top + current_height
    ) - max(previous_top, current_top)
    if (
        vertical_overlap / min(previous_height, current_height) >= 0.50
        and current[0] >= previous[0] + previous[2]
    ):
        return "\t"
    previous_bottom = previous[1] + previous[3]
    gap = current[1] - previous_bottom
    typical_height = max(1, previous[3], current[3])
    return "\n\n" if gap > typical_height * 1.5 else "\n"


def _run_tesseract(
    image: object,
    languages: str,
    deadline: float,
    *,
    page_segmentation_mode: int = 3,
) -> _OcrOutcome:
    import pytesseract

    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return _empty_ocr_outcome(languages, timed_out=True)
    timeout = min(OCR_PAGE_TIMEOUT_SECONDS, remaining)
    image_to_data = getattr(pytesseract, "image_to_data", None)
    output = getattr(getattr(pytesseract, "Output", None), "DICT", None)
    if callable(image_to_data) and output is not None:
        try:
            data = image_to_data(
                image,
                lang=languages,
                config=(
                    f"--oem 1 --psm {page_segmentation_mode} "
                    "-c preserve_interword_spaces=1"
                ),
                output_type=output,
                timeout=timeout,
            )
            return _outcome_from_tesseract_data(data, languages)
        except RuntimeError as exc:
            return _empty_ocr_outcome(languages, timed_out="timeout" in str(exc).casefold())
        except (TypeError, ValueError, KeyError):
            # Fall through for old pytesseract releases and constrained test
            # doubles. Production uses image_to_data for real confidence.
            pass

    image_to_string = getattr(pytesseract, "image_to_string")
    try:
        text = image_to_string(image, lang=languages, timeout=timeout).strip()
    except TypeError:
        # Never retry without a timeout. An older or incompatible pytesseract
        # cannot provide the hard page-deadline guarantee required here.
        return _empty_ocr_outcome(languages, timed_out=True)
    except RuntimeError as exc:
        return _empty_ocr_outcome(languages, timed_out="timeout" in str(exc).casefold())
    quality = _assess_text_quality(text)
    return _OcrOutcome(
        text=text,
        confidence=None,
        low_confidence_word_ratio=None,
        languages=languages,
        engine="tesseract",
        word_count=quality.word_count,
        blocks=(),
        text_quality=quality,
    )


def _outcome_from_tesseract_data(data: dict[str, Any], languages: str) -> _OcrOutcome:
    texts = list(data.get("text", []))
    word_groups: OrderedDict[tuple[int, int, int], list[dict[str, Any]]] = OrderedDict()
    for index, raw_text in enumerate(texts):
        text = str(raw_text or "").strip()
        if not text:
            continue
        block_number = _data_int(data, "block_num", index, 0)
        paragraph_number = _data_int(data, "par_num", index, 0)
        line_number = _data_int(data, "line_num", index, index)
        key = (block_number, paragraph_number, line_number)
        word_groups.setdefault(key, []).append(
            {
                "text": text,
                "confidence": _data_confidence(data, index),
                "left": _data_int(data, "left", index, 0),
                "top": _data_int(data, "top", index, 0),
                "width": _data_int(data, "width", index, 0),
                "height": _data_int(data, "height", index, 0),
            }
        )

    blocks: OrderedDict[int, list[tuple[int, str, list[dict[str, Any]]]]] = OrderedDict()
    for (block_number, paragraph_number, line_number), words in word_groups.items():
        words.sort(key=lambda word: (word["left"], word["top"]))
        blocks.setdefault(block_number, []).append(
            (paragraph_number * 100_000 + line_number, _join_ocr_words(words), words)
        )

    output_parts: list[str] = []
    block_metadata: list[OcrBlockMetadata] = []
    all_confidences: list[tuple[float, int]] = []
    low_confidence_words = 0
    total_words = 0
    cursor = 0
    for block_number, lines in blocks.items():
        if output_parts:
            output_parts.append("\n\n")
            cursor += 2
        start_char = cursor
        block_words: list[dict[str, Any]] = []
        previous_paragraph: int | None = None
        for line_index, (line_key, line_text, words) in enumerate(lines):
            paragraph = line_key // 100_000
            if line_index:
                separator = "\n\n" if paragraph != previous_paragraph else "\n"
                output_parts.append(separator)
                cursor += len(separator)
            output_parts.append(line_text)
            cursor += len(line_text)
            previous_paragraph = paragraph
            block_words.extend(words)
        bbox = _words_bbox(block_words)
        confidences = [
            (float(word["confidence"]), max(1, len(str(word["text"]))))
            for word in block_words
            if word["confidence"] is not None
        ]
        all_confidences.extend(confidences)
        low_confidence_words += sum(
            1
            for word in block_words
            if word["confidence"] is None
            or float(word["confidence"]) < OCR_LOW_CONFIDENCE_THRESHOLD
        )
        total_words += len(block_words)
        block_metadata.append(
            OcrBlockMetadata(
                block_number=block_number,
                bbox=bbox,
                start_char=start_char,
                end_char=cursor,
                confidence=_weighted_confidence(confidences),
                word_count=len(block_words),
            )
        )

    text = "".join(output_parts).strip()
    quality = _assess_text_quality(text)
    return _OcrOutcome(
        text=text,
        confidence=_weighted_confidence(all_confidences),
        low_confidence_word_ratio=(
            low_confidence_words / total_words if total_words else None
        ),
        languages=languages,
        engine="tesseract",
        word_count=total_words,
        blocks=tuple(block_metadata),
        text_quality=quality,
    )


def _join_ocr_words(words: list[dict[str, Any]]) -> str:
    result = ""
    previous: dict[str, Any] | None = None
    for word in words:
        token = str(word["text"])
        if not result or token[:1] in ".,;:!?%)]}" or result[-1:] in "([{":
            result += token
        else:
            gap = int(word["left"]) - (
                int(previous["left"]) + int(previous["width"])
                if previous is not None
                else int(word["left"])
            )
            typical_height = max(
                1,
                int(word["height"]),
                int(previous["height"]) if previous is not None else 1,
            )
            # A wide horizontal gap on one OCR baseline is a table-cell
            # boundary. Preserve it as a tab for the clinical parser.
            separator = "\t" if gap > max(24, typical_height * 1.8) else " "
            result += separator + token
        previous = word
    return result


def _data_int(data: dict[str, Any], key: str, index: int, default: int) -> int:
    values = data.get(key, [])
    try:
        return int(values[index])
    except (IndexError, TypeError, ValueError):
        return default


def _data_confidence(data: dict[str, Any], index: int) -> float | None:
    values = data.get("conf", [])
    try:
        confidence = float(values[index])
    except (IndexError, TypeError, ValueError):
        return None
    return confidence if confidence >= 0 else None


def _words_bbox(words: list[dict[str, Any]]) -> tuple[int, int, int, int]:
    if not words:
        return (0, 0, 0, 0)
    left = min(int(word["left"]) for word in words)
    top = min(int(word["top"]) for word in words)
    right = max(int(word["left"]) + int(word["width"]) for word in words)
    bottom = max(int(word["top"]) + int(word["height"]) for word in words)
    return (left, top, max(0, right - left), max(0, bottom - top))


def _weighted_confidence(values: list[tuple[float, int]]) -> float | None:
    total_weight = sum(weight for _, weight in values)
    if total_weight <= 0:
        return None
    return round(sum(value * weight for value, weight in values) / total_weight, 2)


def _empty_ocr_outcome(
    languages: str,
    *,
    engine: Literal["paddle", "tesseract"] = "tesseract",
    timed_out: bool,
) -> _OcrOutcome:
    quality = _assess_text_quality("")
    return _OcrOutcome(
        text="",
        confidence=None,
        low_confidence_word_ratio=None,
        languages=languages,
        engine=engine,
        word_count=0,
        blocks=(),
        text_quality=quality,
        timed_out=timed_out,
    )


def _replace_ocr_geometry(
    outcome: _OcrOutcome, rotation: int, deskew_angle: float
) -> _OcrOutcome:
    return _OcrOutcome(
        text=outcome.text,
        confidence=outcome.confidence,
        low_confidence_word_ratio=outcome.low_confidence_word_ratio,
        languages=outcome.languages,
        engine=outcome.engine,
        word_count=outcome.word_count,
        blocks=outcome.blocks,
        text_quality=outcome.text_quality,
        rotation=rotation,
        deskew_angle=deskew_angle,
        timed_out=outcome.timed_out,
    )


def _should_try_cyrillic_fallback(outcome: _OcrOutcome) -> bool:
    return (
        not outcome.text_quality.reliable
        or (
            outcome.confidence is not None
            and outcome.confidence < OCR_LOW_CONFIDENCE_THRESHOLD
        )
        or (outcome.low_confidence_word_ratio or 0.0) > 0.35
    )


def _should_retry_preprocessing(outcome: _OcrOutcome) -> bool:
    return bool(
        not outcome.text_quality.reliable
        or outcome.confidence is None
        or outcome.confidence < 78.0
        or (outcome.low_confidence_word_ratio or 0.0) > 0.20
    )


def _prefer_ocr(native_quality: _TextQuality, outcome: _OcrOutcome) -> bool:
    if not outcome.text.strip():
        return False
    if not native_quality.char_count:
        return True
    if outcome.text_quality.reliable and not native_quality.reliable:
        return True
    return outcome.combined_quality > native_quality.score + 0.08


def _assess_text_quality(text: str) -> _TextQuality:
    normalized = unicodedata.normalize("NFKC", text or "").strip()
    if not normalized:
        return _TextQuality(0.0, False, 0, 0, "native_text_empty")

    char_count = len(normalized)
    visible = [character for character in normalized if not character.isspace()]
    visible_count = max(1, len(visible))
    alnum_count = sum(character.isalnum() for character in visible)
    letter_count = sum(character.isalpha() for character in visible)
    bad_controls = sum(
        unicodedata.category(character) == "Cc" and character not in "\n\r\t\f"
        for character in normalized
    )
    replacement_count = normalized.count("\ufffd") + normalized.count("\x00")
    words = _WORD_PATTERN.findall(normalized)
    word_count = len(words)
    very_long_words = sum(len(word) > 40 for word in words)

    alnum_ratio = alnum_count / visible_count
    letter_ratio = letter_count / visible_count
    corruption_ratio = (bad_controls + replacement_count) / visible_count
    long_word_ratio = very_long_words / max(1, word_count)

    length_score = min(1.0, char_count / 140.0)
    word_score = min(1.0, word_count / 16.0)
    alnum_score = min(1.0, alnum_ratio / 0.62)
    letter_score = min(1.0, letter_ratio / 0.55)
    cleanliness_score = max(0.0, 1.0 - corruption_ratio * 20.0 - long_word_ratio)
    score = round(
        0.22 * length_score
        + 0.22 * word_score
        + 0.21 * alnum_score
        + 0.15 * letter_score
        + 0.20 * cleanliness_score,
        4,
    )

    reliable = (
        char_count >= 18
        and letter_count >= 12
        and word_count >= 2
        and alnum_ratio >= 0.48
        and letter_ratio >= 0.38
        and corruption_ratio <= 0.01
        and long_word_ratio <= 0.20
        and score >= 0.57
    )
    if corruption_ratio > 0.01:
        reason = "native_text_contains_corrupt_glyphs"
    elif alnum_ratio < 0.48 or letter_ratio < 0.38:
        reason = "native_text_has_low_readable_character_ratio"
    elif word_count < 2 or char_count < 18:
        reason = "native_text_too_sparse"
    elif long_word_ratio > 0.20:
        reason = "native_text_has_implausible_tokens"
    elif score < 0.57:
        reason = "native_text_failed_quality_score"
    else:
        reason = "native_text_passed_quality_checks"
    return _TextQuality(score, reliable, char_count, word_count, reason)


def _page_has_scan_like_image(page: object) -> bool:
    """Detect a likely page raster without decoding its pixels."""

    try:
        resources = page.get("/Resources")  # type: ignore[attr-defined]
        resources = resources.get_object() if hasattr(resources, "get_object") else resources
        xobjects = resources.get("/XObject") if resources else None
        xobjects = xobjects.get_object() if hasattr(xobjects, "get_object") else xobjects
        if not xobjects:
            return False
        for value in xobjects.values():
            obj = value.get_object() if hasattr(value, "get_object") else value
            if str(obj.get("/Subtype")) != "/Image":
                continue
            width = int(obj.get("/Width", 0))
            height = int(obj.get("/Height", 0))
            if width > 0 and height > 0 and width * height >= 1_000_000:
                return True
    except (AttributeError, TypeError, ValueError):
        return False
    return False


def _normalize_extracted_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("\x00", "")
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(lines).strip()


def _visible_character_count(text: str) -> int:
    return sum(not character.isspace() for character in text)


def _has_useful_text(text: str) -> bool:
    """Compatibility shim; quality is no longer a character-count decision."""

    return _assess_text_quality(text).reliable


def _join_pdf_pages(pages: list[str]) -> str:
    return _checked_extracted_text("\n\f\n".join(page.strip() for page in pages).strip())


def _checked_extracted_text(text: str) -> str:
    _check_extracted_text_limit(len(text))
    return text


def _check_extracted_text_limit(char_count: int) -> None:
    if char_count > MAX_EXTRACTED_TEXT_CHARS:
        raise _ExtractedTextLimitExceeded("Extracted text exceeds the parser character limit")


def _check_pdf_page_limit(page_count: int) -> None:
    if page_count > MAX_PDF_PAGES:
        raise _PdfPageLimitExceeded("PDF exceeds the parser page limit")


def _check_rendered_page_size(page: object) -> None:
    try:
        width, height = page.get_size()  # type: ignore[attr-defined]
    except (AttributeError, TypeError, ValueError):
        return
    render_width = math.ceil(float(width) * PDF_RENDER_SCALE)
    render_height = math.ceil(float(height) * PDF_RENDER_SCALE)
    _check_image_size(render_width, render_height)


def _check_image_size(width: int, height: int) -> None:
    if width <= 0 or height <= 0 or width * height > MAX_IMAGE_PIXELS:
        raise _ImagePixelLimitExceeded("Image exceeds the parser pixel limit")


def _close_resource(resource: object | None) -> None:
    close = getattr(resource, "close", None)
    if callable(close):
        try:
            close()
        except Exception:
            pass


def _metadata_for_ocr(
    page_number: int, route_reason: str, native_text: str, outcome: _OcrOutcome
) -> PageExtractionMetadata:
    native_quality = _assess_text_quality(native_text)
    effective_reason = "ocr_timeout_no_text" if outcome.timed_out else route_reason
    return PageExtractionMetadata(
        page_number=page_number,
        source="ocr",
        route_reason=effective_reason,
        native_quality=native_quality.score,
        native_char_count=native_quality.char_count,
        ocr_confidence=outcome.confidence,
        low_confidence_word_ratio=outcome.low_confidence_word_ratio,
        ocr_languages=outcome.languages,
        ocr_engine=outcome.engine,
        orientation_rotation=outcome.rotation,
        deskew_angle=outcome.deskew_angle,
        word_count=outcome.word_count,
        blocks=outcome.blocks,
    )


def _native_fallback_metadata(
    page_number: int | None, text: str, route_reason: str
) -> PageExtractionMetadata:
    quality = _assess_text_quality(text)
    return PageExtractionMetadata(
        page_number=page_number,
        source="native_fallback",
        route_reason=route_reason,
        native_quality=quality.score,
        native_char_count=quality.char_count,
        word_count=quality.word_count,
    )


def _make_result(
    text: str,
    page_count: int,
    pages: tuple[PageExtractionMetadata, ...],
) -> ExtractionResult:
    return ExtractionResult(
        text=text,
        metadata=ExtractionMetadata(
            page_count=page_count,
            text_chars=len(text),
            used_ocr=any(page.source == "ocr" for page in pages),
            pages=pages,
        ),
    )
