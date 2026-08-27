import json
from pathlib import Path
import sys
import time
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
    _detect_orientation,
    _estimate_skew_angle,
    _extract_native_page_text,
    _get_paddle_ocr,
    _join_pdf_pages,
    _normalize_ocr_confidence,
    _ocr_pil_image,
    _outcome_from_paddle_results,
    _outcome_from_tesseract_data,
    _remove_table_rules,
    _run_tesseract,
    _scale_paddle_outcome,
    _select_ocr_languages,
    extract_document,
    extract_text,
)


class ExtractionLimitsTest(unittest.TestCase):
    def setUp(self) -> None:
        # Unit tests never import or download real Paddle models. Individual
        # Paddle tests opt in with a mocked pipeline.
        engine_patch = patch("app.extraction.OCR_ENGINE", "tesseract")
        isolate_patch = patch("app.extraction.PADDLE_ISOLATE_PROCESS", False)
        multipass_patch = patch("app.extraction.OCR_MULTIPASS_ENABLED", False)
        engine_patch.start()
        isolate_patch.start()
        multipass_patch.start()
        self.addCleanup(engine_patch.stop)
        self.addCleanup(isolate_patch.stop)
        self.addCleanup(multipass_patch.stop)

    def test_parser_rejects_documents_over_the_size_limit(self) -> None:
        with self.assertRaisesRegex(ValueError, "size limit"):
            extract_text(b"x" * (MAX_FILE_BYTES + 1), "text/plain")

    def test_small_utf8_text_is_supported(self) -> None:
        self.assertEqual(
            extract_text(b"Diagnosen\nHypertonie", "text/plain"),
            "Diagnosen\nHypertonie",
        )

    def test_pdf_join_preserves_empty_boundary_pages(self) -> None:
        extracted = _join_pdf_pages(["", "", "Page three", ""])

        self.assertEqual(len(extracted.split("\f")), 4)
        self.assertEqual(
            [part.strip(" \t\r\n") for part in extracted.split("\f")],
            ["", "", "Page three", ""],
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

    def test_document_deadline_exhaustion_is_preserved_in_page_metadata(self) -> None:
        rendered_page = FakeRenderedPage()
        ocr = Mock(return_value="unused")

        with (
            patch("app.extraction.OCR_DOCUMENT_TIMEOUT_SECONDS", -1),
            mocked_pdf_modules([FakeNativePage("")], [rendered_page], ocr),
        ):
            result = extract_document(b"%PDF-deadline", "application/pdf")

        self.assertEqual(
            result.metadata.pages[0].route_reason,
            "document_ocr_deadline_exhausted",
        )
        self.assertEqual(result.metadata.pages[0].source, "native_fallback")
        rendered_page.render.assert_not_called()
        ocr.assert_not_called()

    def test_tesseract_timeout_never_exceeds_remaining_page_deadline(self) -> None:
        data_ocr = Mock(return_value=fake_tesseract_data())
        fake_tesseract = SimpleNamespace(
            Output=SimpleNamespace(DICT="dict"), image_to_data=data_ocr
        )
        with (
            patch("app.extraction.time.monotonic", return_value=100.0),
            patch.dict(sys.modules, {"pytesseract": fake_tesseract}),
        ):
            _run_tesseract(object(), "deu+eng", 100.025)

        timeout = data_ocr.call_args.kwargs["timeout"]
        self.assertGreater(timeout, 0)
        self.assertAlmostEqual(timeout, 0.025, places=6)

    def test_orientation_timeout_never_exceeds_remaining_page_deadline(self) -> None:
        osd = Mock(return_value="Orientation in degrees: 0")
        fake_tesseract = SimpleNamespace(image_to_osd=osd)
        with (
            patch("app.extraction.time.monotonic", return_value=200.0),
            patch.dict(sys.modules, {"pytesseract": fake_tesseract}),
        ):
            _detect_orientation(object(), 200.02)

        timeout = osd.call_args.kwargs["timeout"]
        self.assertGreater(timeout, 0)
        self.assertAlmostEqual(timeout, 0.02, places=6)

    def test_tesseract_never_retries_without_timeout_support(self) -> None:
        image_to_string = Mock(side_effect=TypeError("timeout is unsupported"))
        fake_tesseract = SimpleNamespace(image_to_string=image_to_string)
        with (
            patch("app.extraction.time.monotonic", return_value=300.0),
            patch.dict(sys.modules, {"pytesseract": fake_tesseract}),
        ):
            outcome = _run_tesseract(object(), "deu+eng", 301.0)

        self.assertTrue(outcome.timed_out)
        self.assertEqual(image_to_string.call_count, 1)
        self.assertIn("timeout", image_to_string.call_args.kwargs)

    def test_page_render_failure_is_marked_as_incomplete_ocr(self) -> None:
        rendered_page = FakeRenderedPage()
        rendered_page.render.side_effect = RuntimeError("malformed page image")

        with mocked_pdf_modules(
            [FakeNativePage("Diagnose")], [rendered_page], Mock(return_value="unused")
        ):
            result = extract_document(b"%PDF-render-failure", "application/pdf")

        self.assertEqual(result.text, "Diagnose")
        self.assertEqual(result.metadata.pages[0].source, "native_fallback")
        self.assertEqual(
            result.metadata.pages[0].route_reason,
            "ocr_failed_native_fragment_preserved",
        )

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

    def test_missing_paddle_confidence_counts_as_low_confidence_text(self) -> None:
        result = SimpleNamespace(
            json={
                "res": {
                    "rec_texts": ["High score", "Missing score"],
                    "rec_scores": [0.96],
                    "rec_boxes": [[10, 10, 100, 20], [10, 40, 100, 20]],
                }
            }
        )

        outcome = _outcome_from_paddle_results([result])

        self.assertEqual(outcome.confidence, 96.0)
        self.assertEqual(outcome.low_confidence_word_ratio, 0.5)
        self.assertIsNone(outcome.blocks[1].confidence)

    def test_missing_tesseract_confidence_counts_as_low_confidence_word(self) -> None:
        data = {
            "text": ["Diagnosen", "Hypertonie"],
            "conf": ["95", ""],
            "block_num": [1, 1],
            "par_num": [1, 1],
            "line_num": [1, 1],
            "left": [10, 100],
            "top": [10, 10],
            "width": [80, 80],
            "height": [20, 20],
        }

        outcome = _outcome_from_tesseract_data(data, "deu+eng")

        self.assertEqual(outcome.confidence, 95.0)
        self.assertEqual(outcome.low_confidence_word_ratio, 0.5)

    def test_paddle_blocks_are_sorted_in_two_column_reading_order(self) -> None:
        result = SimpleNamespace(
            json={
                "res": {
                    "rec_texts": ["Right 2", "Left 1", "Right 1", "Left 2"],
                    "rec_scores": [0.9, 0.9, 0.9, 0.9],
                    "rec_boxes": [
                        [320, 80, 490, 100],
                        [10, 10, 180, 30],
                        [320, 10, 490, 30],
                        [10, 80, 180, 100],
                    ],
                }
            }
        )

        outcome = _outcome_from_paddle_results([result])

        self.assertEqual(outcome.text, "Left 1\n\nLeft 2\nRight 1\n\nRight 2")

    def test_numeric_lab_table_keeps_row_major_cell_order(self) -> None:
        result = SimpleNamespace(
            json={
                "res": {
                    "rec_texts": [
                        "7.1",
                        "CRP",
                        "g/dL",
                        "Hemoglobin",
                        "3.0",
                        "G/L",
                        "Leukocytes",
                        "12.4",
                        "mg/L",
                    ],
                    "rec_scores": [0.95] * 9,
                    "rec_boxes": [
                        [250, 52, 310, 72],
                        [10, 90, 180, 110],
                        [400, 11, 470, 31],
                        [10, 10, 180, 30],
                        [250, 92, 310, 112],
                        [400, 51, 470, 71],
                        [10, 50, 180, 70],
                        [250, 12, 310, 32],
                        [400, 91, 470, 111],
                    ],
                }
            }
        )

        outcome = _outcome_from_paddle_results([result])

        self.assertEqual(
            outcome.text,
            "Hemoglobin\t12.4\tg/dL\nLeukocytes\t7.1\tG/L\nCRP\t3.0\tmg/L",
        )

    def test_tall_lab_boxes_do_not_transitively_chain_adjacent_rows(self) -> None:
        result = SimpleNamespace(
            json={
                "res": {
                    "rec_texts": [
                        "Magnesium intraerythrozytär",
                        "Eisen",
                        "Ferritin",
                        "Selen (Se)",
                        "2.00",
                        "73",
                        "56",
                        "108",
                        "(",
                        "1.65",
                        "70",
                        "20",
                        "50",
                        "2.65",
                        "180",
                        "250",
                        "120",
                        ")mmol/l",
                        ") μg/dl",
                        ") µg/l",
                        "μg/l",
                    ],
                    "rec_scores": [0.95] * 21,
                    "rec_boxes": [
                        [0, 1016, 387, 1056],
                        [0, 1049, 85, 1082],
                        [0, 1081, 105, 1114],
                        [0, 1111, 156, 1151],
                        [653, 1013, 719, 1045],
                        [653, 1044, 696, 1077],
                        [651, 1076, 696, 1109],
                        [653, 1109, 709, 1141],
                        [948, 1026, 961, 1046],
                        [991, 1019, 1054, 1049],
                        [1011, 1049, 1054, 1082],
                        [1011, 1079, 1054, 1116],
                        [1011, 1112, 1054, 1147],
                        [1104, 1018, 1170, 1048],
                        [1106, 1048, 1164, 1080],
                        [1103, 1076, 1163, 1113],
                        [1104, 1109, 1162, 1142],
                        [1192, 1008, 1313, 1050],
                        [1192, 1038, 1295, 1086],
                        [1194, 1071, 1279, 1117],
                        [1192, 1102, 1278, 1148],
                    ],
                }
            }
        )

        outcome = _outcome_from_paddle_results([result])

        self.assertEqual(
            outcome.text,
            "Magnesium intraerythrozytär\t2.00\t(\t1.65\t2.65\t)mmol/l\n"
            "Eisen\t73\t70\t180\t) μg/dl\n"
            "Ferritin\t56\t20\t250\t) µg/l\n"
            "Selen (Se)\t108\t50\t120\tμg/l",
        )
        self.assertEqual(
            [outcome.text[block.start_char : block.end_char] for block in outcome.blocks],
            [
                "Magnesium intraerythrozytär",
                "2.00",
                "(",
                "1.65",
                "2.65",
                ")mmol/l",
                "Eisen",
                "73",
                "70",
                "180",
                ") μg/dl",
                "Ferritin",
                "56",
                "20",
                "250",
                ") µg/l",
                "Selen (Se)",
                "108",
                "50",
                "120",
                "μg/l",
            ],
        )

    def test_becker_differential_rows_use_vertical_overlap_not_margin_noise(self) -> None:
        result = SimpleNamespace(
            json={
                "res": {
                    "rec_texts": [
                        "S",
                        "basophile Granulozyten",
                        "Lymphozyten",
                        "Monozyten",
                        "1.2",
                        "bis",
                        "2.0",
                        ") %",
                        "35.9",
                        "17.0",
                        "47.0",
                        ") %",
                        "8.1",
                        "4.0",
                        "12.0",
                        ") %",
                        "Diesen Befund können",
                        "neutrophile Granulozyten",
                        "1.840",
                        "1.800",
                        "6.200",
                        ") Tsd./μl",
                    ],
                    "rec_scores": [
                        0.34,
                        *([0.99] * 15),
                        0.32,
                        *([0.99] * 5),
                    ],
                    "rec_boxes": [
                        [3, 1421, 15, 1441],
                        [80, 1355, 389, 1397],
                        [80, 1385, 266, 1425],
                        [81, 1418, 234, 1451],
                        [676, 1370, 727, 1403],
                        [1015, 1376, 1065, 1408],
                        [1104, 1375, 1159, 1407],
                        [1191, 1370, 1251, 1410],
                        [673, 1398, 741, 1433],
                        [1000, 1406, 1063, 1438],
                        [1101, 1404, 1171, 1436],
                        [1187, 1400, 1250, 1442],
                        [673, 1431, 724, 1463],
                        [1008, 1436, 1063, 1468],
                        [1066, 1436, 1171, 1466],
                        [1191, 1434, 1247, 1467],
                        [0, 1433, 23, 1566],
                        [81, 1474, 410, 1516],
                        [674, 1486, 752, 1521],
                        [952, 1496, 1057, 1526],
                        [1103, 1499, 1181, 1524],
                        [1187, 1497, 1297, 1527],
                    ],
                }
            }
        )

        outcome = _outcome_from_paddle_results([result])

        self.assertEqual(
            outcome.text,
            "basophile Granulozyten\t1.2\tbis\t2.0\t) %\n"
            "Lymphozyten\t35.9\t17.0\t47.0\t) %\n"
            "Monozyten\t8.1\t4.0\t12.0\t) %\n"
            "neutrophile Granulozyten\t1.840\t1.800\t6.200\t) Tsd./μl",
        )

    def test_becker_enzyme_rows_keep_comparator_with_its_analyte(self) -> None:
        result = SimpleNamespace(
            json={
                "res": {
                    "rec_texts": [
                        "GOT (ASAT)",
                        "15",
                        "<",
                        "50",
                        ") U/l",
                        "GPT (ALAT)",
                        "18",
                        "<",
                        "50",
                        ") U/l",
                        "SSS",
                        "gamma-GT",
                        "12",
                        "<",
                        "60",
                        ") U/l",
                    ],
                    "rec_scores": [0.99] * 16,
                    "rec_boxes": [
                        [56, 1605, 222, 1650],
                        [664, 1617, 704, 1652],
                        [1021, 1633, 1043, 1658],
                        [1096, 1630, 1136, 1661],
                        [1178, 1623, 1251, 1664],
                        [58, 1638, 217, 1679],
                        [664, 1646, 704, 1681],
                        [1021, 1663, 1043, 1686],
                        [1096, 1656, 1136, 1691],
                        [1180, 1655, 1253, 1696],
                        [1354, 1627, 1394, 1726],
                        [63, 1678, 205, 1708],
                        [667, 1680, 702, 1711],
                        [1021, 1694, 1043, 1716],
                        [1096, 1686, 1136, 1721],
                        [1183, 1688, 1249, 1724],
                    ],
                }
            }
        )

        outcome = _outcome_from_paddle_results([result])

        self.assertIn("GOT (ASAT)\t15\t<\t50\t) U/l", outcome.text)
        self.assertIn("GPT (ALAT)\t18\t<\t50\t) U/l", outcome.text)
        self.assertIn("gamma-GT\t12\t<\t60\t) U/l", outcome.text)

    def test_tesseract_geometry_preserves_lab_column_boundaries(self) -> None:
        outcome = _outcome_from_tesseract_data(
            {
                "text": ["Leukocytes", "6,4", "G/L", "3,7", "-", "9,9"],
                "conf": ["95"] * 6,
                "block_num": [1] * 6,
                "par_num": [1] * 6,
                "line_num": [1] * 6,
                "left": [10, 260, 390, 520, 555, 580],
                "top": [10] * 6,
                "width": [120, 35, 40, 30, 10, 30],
                "height": [20] * 6,
            },
            "deu+eng",
        )

        self.assertEqual(outcome.text, "Leukocytes\t6,4\tG/L\t3,7 - 9,9")

    def test_paddle_boxes_are_scaled_back_to_ocr_image_coordinates(self) -> None:
        outcome = _outcome_from_paddle_results([fake_paddle_result()])
        source = SimpleNamespace(size=(2560, 1280))
        paddle_input = SimpleNamespace(shape=(640, 1280, 3))

        scaled = _scale_paddle_outcome(outcome, source, paddle_input)

        self.assertEqual(scaled.blocks[0].bbox, (20, 20, 340, 40))

    def test_text_hint_selects_specific_cyrillic_language_pack(self) -> None:
        self.assertEqual(_select_ocr_languages("Зміни відсутні і є", None), "deu+eng+ukr")
        self.assertEqual(_select_ocr_languages("Изменения были", None), "deu+eng+rus")

    def test_low_confidence_cyrillic_osd_keeps_latin_paddle_route(self) -> None:
        rendered_page = FakeRenderedPage()
        paddle_outcome = _outcome_from_paddle_results([fake_paddle_result()])
        data_ocr = Mock(return_value=fake_tesseract_data())

        with (
            patch("app.extraction.OCR_ENGINE", "paddle"),
            patch("app.extraction._run_paddle", return_value=paddle_outcome) as paddle,
            patch("app.extraction._should_try_cyrillic_fallback", return_value=False),
            mocked_pdf_modules(
                [FakeNativePage("")],
                [rendered_page],
                Mock(return_value="unused"),
                data_ocr=data_ocr,
                osd_text=(
                    "Orientation in degrees: 0\nRotate: 0\n"
                    "Orientation confidence: 12.0\nScript: Cyrillic\n"
                    "Script confidence: 2.0\n"
                ),
            ),
        ):
            result = extract_document(b"%PDF-latin-low-confidence-osd", "application/pdf")

        self.assertEqual(result.metadata.pages[0].ocr_engine, "paddle")
        self.assertEqual(result.metadata.pages[0].ocr_languages, "latin")
        paddle.assert_called_once()
        data_ocr.assert_not_called()

    def test_becker_pages_one_and_two_keep_latin_paddle_route_and_decimals(self) -> None:
        fixture_path = (
            Path(__file__).parent / "fixtures" / "becker_lab_pages_1_2_ocr.json"
        )
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        pages = fixture["pages"]
        paddle_outcomes = [
            _outcome_from_paddle_results(
                [SimpleNamespace(json={"res": page["paddle"]})]
            )
            for page in pages
        ]
        data_ocr = Mock(return_value=fake_tesseract_data())

        with (
            patch("app.extraction.OCR_ENGINE", "paddle"),
            patch("app.extraction._run_paddle", side_effect=paddle_outcomes) as paddle,
            patch("app.extraction._should_try_cyrillic_fallback", return_value=False),
            mocked_pdf_modules(
                [FakeNativePage("") for _page in pages],
                [FakeRenderedPage() for _page in pages],
                Mock(return_value="unused"),
                data_ocr=data_ocr,
                osd_text=[page["osd"] for page in pages],
            ),
        ):
            result = extract_document(b"%PDF-deidentified-becker-pages-1-2", "application/pdf")

        self.assertEqual(result.metadata.page_count, 2)
        self.assertEqual(
            [
                (page.page_number, page.source, page.ocr_engine, page.ocr_languages)
                for page in result.metadata.pages
            ],
            [
                (1, "ocr", "paddle", "latin"),
                (2, "ocr", "paddle", "latin"),
            ],
        )
        page_one, page_two = result.text.split("\f")
        for decimal in ("13.5", "47.0", "4.0"):
            self.assertIn(decimal, page_one)
        self.assertNotIn("135", page_one)
        self.assertNotIn("470", page_one)
        self.assertNotIn("\t40\t", f"\t{page_one}\t")
        self.assertIn("CRP, high sensitive", page_two)
        self.assertIn("1 - 3", page_two)
        self.assertIn("Lipoprotein (a)", page_two)
        self.assertEqual(paddle.call_count, 2)
        data_ocr.assert_not_called()

    def test_weak_first_pass_uses_bounded_binarized_retry(self) -> None:
        from PIL import Image

        weak = _outcome_from_tesseract_data(
            {
                "text": ["x"],
                "conf": ["20"],
                "block_num": [1],
                "par_num": [1],
                "line_num": [1],
                "left": [10],
                "top": [10],
                "width": [10],
                "height": [10],
            },
            "deu+eng",
        )
        strong = _outcome_from_tesseract_data(fake_tesseract_data(), "deu+eng")
        image = Image.new("RGB", (1000, 1000), "white")
        try:
            with (
                patch("app.extraction.OCR_MULTIPASS_ENABLED", True),
                patch("app.extraction.OCR_DESKEW_ENABLED", False),
                patch("app.extraction._detect_orientation", return_value=(0, None, None)),
                patch("app.extraction._run_ocr_engine", side_effect=[weak, strong]) as run,
            ):
                outcome = _ocr_pil_image(image, time.monotonic() + 10, "")
        finally:
            image.close()

        self.assertEqual(outcome.text, strong.text)
        self.assertEqual(run.call_count, 2)

    def test_table_rule_cleanup_preserves_short_content_strokes(self) -> None:
        from PIL import Image, ImageDraw

        image = Image.new("L", (200, 120), "white")
        draw = ImageDraw.Draw(image)
        draw.line((10, 20, 190, 20), fill=0, width=1)
        draw.line((40, 5, 40, 115), fill=0, width=1)
        draw.rectangle((70, 60, 82, 72), fill=0)
        cleaned, removed_rule_count = _remove_table_rules(image)
        try:
            self.assertGreaterEqual(removed_rule_count, 2)
            self.assertEqual(cleaned.getpixel((100, 20)), 255)
            self.assertEqual(cleaned.getpixel((40, 90)), 255)
            self.assertEqual(cleaned.getpixel((76, 66)), 0)
        finally:
            cleaned.close()
            image.close()

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
                    "Script confidence: 21.0\n"
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
        osd_text: str | list[str] | None = None,
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
            if isinstance(self.osd_text, list):
                fake_tesseract.image_to_osd = Mock(side_effect=self.osd_text)
            else:
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
