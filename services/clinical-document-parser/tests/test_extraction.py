import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import warnings

from app.extraction import (
    MAX_EXTRACTED_TEXT_CHARS,
    MAX_FILE_BYTES,
    OCR_CYRILLIC_LANGUAGES,
    PADDLE_DETECTION_MODEL,
    PADDLE_DETECTION_SIDE_LENGTH,
    PADDLE_RECOGNITION_MODEL,
    _estimate_skew_angle,
    _extract_native_page_text,
    _get_paddle_ocr,
    _normalize_ocr_confidence,
    extract_document,
    extract_text,
)


class ExtractionLimitsTest(unittest.TestCase):
    def setUp(self) -> None:
        # Unit tests never import or download real Paddle models. Individual
        # Paddle tests opt in with a mocked pipeline.
        engine_patch = patch("app.extraction.OCR_ENGINE", "tesseract")
        engine_patch.start()
        self.addCleanup(engine_patch.stop)

    def test_parser_rejects_documents_over_the_size_limit(self) -> None:
        with self.assertRaisesRegex(ValueError, "size limit"):
            extract_text(b"x" * (MAX_FILE_BYTES + 1), "text/plain")

    def test_small_utf8_text_is_supported(self) -> None:
        self.assertEqual(
            extract_text(b"Diagnosen\nHypertonie", "text/plain"),
            "Diagnosen\nHypertonie",
        )

    def test_extracted_text_character_limit_is_enforced(self) -> None:
        with patch("app.extraction.MAX_EXTRACTED_TEXT_CHARS", 20):
            with self.assertRaisesRegex(ValueError, "character limit"):
                extract_text(b"x" * 21, "text/plain")

        self.assertGreater(MAX_EXTRACTED_TEXT_CHARS, 20)

    def test_pdf_page_count_is_validated_before_existing_text_is_trusted(self) -> None:
        existing_text = "Diagnosen\n" + ("Hypertonie " * 12)
        native_pages = [FakeNativePage(""), FakeNativePage("")]

        with patch("app.extraction.MAX_PDF_PAGES", 1):
            with mocked_pdf_modules(native_pages, [], Mock()):
                with self.assertRaisesRegex(ValueError, "page limit"):
                    extract_text(b"%PDF-too-many", "application/pdf", existing_text)

    def test_oversized_native_pdf_text_does_not_retry_with_ocr(self) -> None:
        rendered_page = FakeRenderedPage()
        with patch("app.extraction.MAX_EXTRACTED_TEXT_CHARS", 20):
            with mocked_pdf_modules([FakeNativePage("x" * 21)], [rendered_page], Mock()):
                with self.assertRaisesRegex(ValueError, "character limit"):
                    extract_text(b"%PDF-large-text", "application/pdf")

        rendered_page.render.assert_not_called()

    def test_pdf_keeps_good_native_pages_and_ocrs_only_weak_pages(self) -> None:
        good_text = "Diagnosen\n" + ("Hypertonie " * 12)
        native_pages = [FakeNativePage(good_text), FakeNativePage("")]
        rendered_pages = [FakeRenderedPage(), FakeRenderedPage()]
        ocr = Mock(return_value="OCR text from scanned page")

        with mocked_pdf_modules(native_pages, rendered_pages, ocr):
            result = extract_text(b"%PDF-mixed", "application/pdf")

        self.assertEqual(result, f"{good_text.strip()}\n\f\nOCR text from scanned page")
        self.assertEqual(rendered_pages[0].render.call_count, 0)
        self.assertEqual(rendered_pages[1].render.call_count, 1)
        ocr.assert_called_once()

    def test_short_but_clean_native_page_is_not_needlessly_ocred(self) -> None:
        native_text = "Diagnose\nArterielle Hypertonie"
        rendered_page = FakeRenderedPage()
        ocr = Mock(return_value="unused")

        with mocked_pdf_modules([FakeNativePage(native_text)], [rendered_page], ocr):
            result = extract_document(b"%PDF-short-native", "application/pdf")

        self.assertEqual(result.text, native_text)
        self.assertFalse(result.metadata.used_ocr)
        self.assertEqual(result.metadata.pages[0].source, "native")
        rendered_page.render.assert_not_called()
        ocr.assert_not_called()

    def test_layout_mode_falls_back_if_it_loses_native_glyphs(self) -> None:
        class DualModePage:
            def extract_text(self, *, extraction_mode: str | None = None) -> str:
                if extraction_mode == "layout":
                    return "Diagnose"
                return "Diagnose\nArterielle Hypertonie\nWeitere Befunde"

        self.assertEqual(
            _extract_native_page_text(DualModePage()),
            "Diagnose\nArterielle Hypertonie\nWeitere Befunde",
        )

    def test_long_symbol_noise_is_routed_to_ocr(self) -> None:
        native_text = "@#$%^&* " * 40
        rendered_page = FakeRenderedPage()
        ocr = Mock(return_value="Diagnose\nArterielle Hypertonie")

        with mocked_pdf_modules([FakeNativePage(native_text)], [rendered_page], ocr):
            result = extract_document(b"%PDF-noisy-native", "application/pdf")

        self.assertEqual(result.text, "Diagnose\nArterielle Hypertonie")
        self.assertTrue(result.metadata.used_ocr)
        self.assertEqual(result.metadata.pages[0].source, "ocr")
        rendered_page.render.assert_called_once()

    def test_word_level_ocr_builds_layout_and_real_confidence_metadata(self) -> None:
        rendered_page = FakeRenderedPage()
        data_ocr = Mock(return_value=fake_tesseract_data())

        with mocked_pdf_modules(
            [FakeNativePage("")],
            [rendered_page],
            Mock(return_value="unused"),
            data_ocr=data_ocr,
        ):
            result = extract_document(b"%PDF-word-data", "application/pdf")

        self.assertEqual(
            result.text,
            "Diagnosen Hypertonie\n\nAnamnese Keine Beschwerden",
        )
        page = result.metadata.pages[0]
        self.assertEqual(page.source, "ocr")
        self.assertGreater(page.ocr_confidence or 0, 90)
        self.assertEqual(page.word_count, 4)
        self.assertEqual(len(page.blocks), 2)
        self.assertEqual(
            result.text[page.blocks[0].start_char : page.blocks[0].end_char],
            "Diagnosen Hypertonie",
        )
        data_ocr.assert_called_once()

    def test_paddle_mobile_pipeline_is_lazy_singleton_with_cpu_safe_config(self) -> None:
        constructor = Mock(return_value=object())
        fake_module = SimpleNamespace(PaddleOCR=constructor)

        with (
            patch.dict(sys.modules, {"paddleocr": fake_module}),
            patch("app.extraction._PADDLE_OCR", None),
            patch("app.extraction._PADDLE_OCR_INIT_FAILED", False),
        ):
            first = _get_paddle_ocr()
            second = _get_paddle_ocr()

        self.assertIs(first, second)
        constructor.assert_called_once()
        options = constructor.call_args.kwargs
        self.assertEqual(options["text_detection_model_name"], PADDLE_DETECTION_MODEL)
        self.assertEqual(options["text_recognition_model_name"], PADDLE_RECOGNITION_MODEL)
        self.assertEqual(options["text_det_limit_side_len"], PADDLE_DETECTION_SIDE_LENGTH)
        self.assertEqual(options["text_det_limit_type"], "max")
        self.assertEqual(options["device"], "cpu")
        self.assertFalse(options["enable_mkldnn"])
        self.assertTrue(options["use_doc_orientation_classify"])
        self.assertTrue(options["use_doc_unwarping"])
        self.assertTrue(options["use_textline_orientation"])

    def test_paddle_result_preserves_confidence_bboxes_and_offsets(self) -> None:
        rendered_page = FakeRenderedPage()
        pipeline = SimpleNamespace(predict=Mock(return_value=[fake_paddle_result()]))
        tesseract = Mock(return_value="unused")

        with (
            patch("app.extraction.OCR_ENGINE", "paddle"),
            patch("app.extraction._get_paddle_ocr", return_value=pipeline),
            patch("app.extraction._paddle_image_array", return_value=object()),
            mocked_pdf_modules([FakeNativePage("")], [rendered_page], tesseract),
        ):
            result = extract_document(b"%PDF-paddle", "application/pdf")

        self.assertEqual(
            result.text,
            "Diagnosen Hypertonie\n\nAnamnese Keine Beschwerden",
        )
        page = result.metadata.pages[0]
        self.assertEqual(page.ocr_engine, "paddle")
        self.assertEqual(page.ocr_languages, "latin")
        self.assertGreater(page.ocr_confidence or 0, 80)
        self.assertEqual(page.blocks[0].bbox, (10, 10, 170, 20))
        self.assertEqual(
            result.text[page.blocks[1].start_char : page.blocks[1].end_char],
            "Anamnese Keine Beschwerden",
        )
        tesseract.assert_not_called()

    def test_paddle_exception_or_empty_result_falls_back_to_tesseract(self) -> None:
        for paddle_result in (RuntimeError("inference failed"), [fake_paddle_result(empty=True)]):
            with self.subTest(paddle_result=type(paddle_result).__name__):
                rendered_page = FakeRenderedPage()
                predict = (
                    Mock(side_effect=paddle_result)
                    if isinstance(paddle_result, Exception)
                    else Mock(return_value=paddle_result)
                )
                pipeline = SimpleNamespace(predict=predict)
                data_ocr = Mock(return_value=fake_tesseract_data())
                with (
                    patch("app.extraction.OCR_ENGINE", "paddle"),
                    patch("app.extraction._get_paddle_ocr", return_value=pipeline),
                    patch("app.extraction._paddle_image_array", return_value=object()),
                    mocked_pdf_modules(
                        [FakeNativePage("")],
                        [rendered_page],
                        Mock(return_value="unused"),
                        data_ocr=data_ocr,
                    ),
                ):
                    result = extract_document(b"%PDF-paddle-fallback", "application/pdf")

                self.assertEqual(result.metadata.pages[0].ocr_engine, "tesseract")
                data_ocr.assert_called_once()

    def test_paddle_confidence_is_normalized_to_percent(self) -> None:
        self.assertEqual(_normalize_ocr_confidence(0.934), 93.4)
        self.assertEqual(_normalize_ocr_confidence(82), 82.0)
        self.assertEqual(_normalize_ocr_confidence(125), 100.0)

    def test_cyrillic_osd_selects_cyrillic_fallback_languages_first(self) -> None:
        rendered_page = FakeRenderedPage()
        data_ocr = Mock(return_value=fake_tesseract_data())

        with (
            patch("app.extraction.OCR_ENGINE", "paddle"),
            patch("app.extraction._run_paddle") as paddle,
            mocked_pdf_modules(
                [FakeNativePage("")],
                [rendered_page],
                Mock(return_value="unused"),
                data_ocr=data_ocr,
                osd_text=(
                    "Orientation in degrees: 0\nRotate: 0\n"
                    "Orientation confidence: 12.0\nScript: Cyrillic\n"
                ),
            ),
        ):
            result = extract_document(b"%PDF-cyrillic", "application/pdf")

        self.assertEqual(result.metadata.pages[0].ocr_languages, OCR_CYRILLIC_LANGUAGES)
        self.assertEqual(result.metadata.pages[0].ocr_engine, "tesseract")
        self.assertEqual(data_ocr.call_args.kwargs["lang"], OCR_CYRILLIC_LANGUAGES)
        paddle.assert_not_called()

    def test_small_scan_skew_is_detected_on_bounded_thumbnail(self) -> None:
        from PIL import Image, ImageDraw

        base = Image.new("L", (800, 500), 255)
        draw = ImageDraw.Draw(base)
        for top in range(80, 420, 35):
            draw.rectangle((80, top, 720, top + 7), fill=0)
        skewed = base.rotate(2, expand=True, fillcolor=255)
        try:
            self.assertEqual(_estimate_skew_angle(skewed), -2.0)
        finally:
            skewed.close()
            base.close()

    def test_malformed_pypdf_falls_back_to_local_pdf_ocr(self) -> None:
        rendered_page = FakeRenderedPage()
        ocr = Mock(return_value="Locally OCRed page")

        with mocked_pdf_modules([], [rendered_page], ocr, reader_error=RuntimeError("bad xref")):
            result = extract_text(b"%PDF-malformed", "application/pdf")

        self.assertEqual(result, "Locally OCRed page")
        rendered_page.render.assert_called_once()

    def test_pypdf_warning_does_not_abort_native_extraction(self) -> None:
        good_text = "Befund\n" + ("Unauffaellig " * 12)
        native_pages = [FakeNativePage(good_text)]

        with warnings.catch_warnings():
            warnings.simplefilter("error")
            with mocked_pdf_modules(native_pages, [], Mock(), reader_warning=True):
                result = extract_text(b"%PDF-warning", "application/pdf")

        self.assertEqual(result, good_text.strip())

    def test_native_pdf_page_limit_is_enforced_before_ocr(self) -> None:
        native_pages = [FakeNativePage(""), FakeNativePage("")]
        with patch("app.extraction.MAX_PDF_PAGES", 1):
            with mocked_pdf_modules(native_pages, [], Mock()):
                with self.assertRaisesRegex(ValueError, "page limit"):
                    extract_text(b"%PDF-too-many", "application/pdf")

    def test_pdfium_page_limit_is_enforced_after_malformed_pypdf(self) -> None:
        rendered_pages = [FakeRenderedPage(), FakeRenderedPage()]
        with patch("app.extraction.MAX_PDF_PAGES", 1):
            with mocked_pdf_modules(
                [], rendered_pages, Mock(), reader_error=RuntimeError("bad xref")
            ):
                with self.assertRaisesRegex(ValueError, "page limit"):
                    extract_text(b"%PDF-too-many", "application/pdf")

    def test_rendered_pdf_page_pixel_limit_is_checked_before_rendering(self) -> None:
        rendered_page = FakeRenderedPage(size=(10_000, 10_000))
        with patch("app.extraction.MAX_IMAGE_PIXELS", 1_000_000):
            with mocked_pdf_modules([FakeNativePage("")], [rendered_page], Mock()):
                with self.assertRaisesRegex(ValueError, "pixel limit"):
                    extract_text(b"%PDF-huge-page", "application/pdf")

        rendered_page.render.assert_not_called()


class FakeNativePage:
    def __init__(self, text: str) -> None:
        self.text = text

    def extract_text(self) -> str:
        return self.text


class FakeRenderedPage:
    def __init__(self, size: tuple[int, int] = (600, 800)) -> None:
        self.size = size
        image = SimpleNamespace(width=size[0], height=size[1])
        bitmap = SimpleNamespace(to_pil=Mock(return_value=image))
        self.render = Mock(return_value=bitmap)

    def get_size(self) -> tuple[int, int]:
        return self.size


class mocked_pdf_modules:
    def __init__(
        self,
        native_pages: list[FakeNativePage],
        rendered_pages: list[FakeRenderedPage],
        ocr: Mock,
        *,
        reader_error: Exception | None = None,
        reader_warning: bool = False,
        data_ocr: Mock | None = None,
        osd_text: str | None = None,
    ) -> None:
        self.native_pages = native_pages
        self.rendered_pages = rendered_pages
        self.ocr = ocr
        self.reader_error = reader_error
        self.reader_warning = reader_warning
        self.data_ocr = data_ocr
        self.osd_text = osd_text
        self.stack = None

    def __enter__(self) -> None:
        native_pages = self.native_pages
        reader_error = self.reader_error
        reader_warning = self.reader_warning

        class FakePdfReader:
            def __init__(self, _stream: object, *, strict: bool) -> None:
                self.strict = strict
                if reader_warning:
                    warnings.warn("recoverable pypdf warning", UserWarning)
                if reader_error:
                    raise reader_error
                self.pages = native_pages

        class FakePdfDocument:
            def __init__(self, _data: bytes) -> None:
                self.pages = self_pages

            def __len__(self) -> int:
                return len(self.pages)

            def __getitem__(self, index: int) -> FakeRenderedPage:
                return self.pages[index]

        self_pages = self.rendered_pages
        fake_pypdf = SimpleNamespace(PdfReader=FakePdfReader)
        fake_pdfium = SimpleNamespace(PdfDocument=FakePdfDocument)
        fake_tesseract = SimpleNamespace(image_to_string=self.ocr)
        if self.data_ocr is not None:
            fake_tesseract.Output = SimpleNamespace(DICT="dict")
            fake_tesseract.image_to_data = self.data_ocr
        if self.osd_text is not None:
            fake_tesseract.image_to_osd = Mock(return_value=self.osd_text)
        self.stack = patch.dict(
            sys.modules,
            {
                "pypdf": fake_pypdf,
                "pypdfium2": fake_pdfium,
                "pytesseract": fake_tesseract,
            },
        )
        self.stack.start()

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        assert self.stack is not None
        self.stack.stop()


def fake_tesseract_data() -> dict[str, list[object]]:
    return {
        "text": ["Diagnosen", "Hypertonie", "Anamnese", "Keine Beschwerden"],
        "conf": ["96", "94", "92", "90"],
        "block_num": [1, 1, 2, 2],
        "par_num": [1, 1, 1, 1],
        "line_num": [1, 1, 1, 1],
        "left": [10, 100, 10, 100],
        "top": [10, 10, 80, 80],
        "width": [80, 80, 80, 150],
        "height": [20, 20, 20, 20],
    }


def fake_paddle_result(*, empty: bool = False) -> SimpleNamespace:
    payload = {
        "rec_texts": [] if empty else [
            "Diagnosen Hypertonie",
            "Anamnese Keine Beschwerden",
        ],
        "rec_scores": [] if empty else [0.96, 0.72],
        "rec_boxes": [] if empty else [[10, 10, 180, 30], [10, 80, 250, 100]],
    }
    return SimpleNamespace(json={"res": payload})


if __name__ == "__main__":
    unittest.main()
