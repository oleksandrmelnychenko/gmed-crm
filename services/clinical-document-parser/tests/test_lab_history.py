"""Synthetic regressions; never store patient documents or real results here."""

import pytest
from PIL import Image, ImageDraw

from app.extraction import (
    _outcome_from_grid_data,
    _remove_table_rules,
    _rescale_ocr_blocks,
)
from app.lab_grid import ruled_history_columns
from app.parser import parse_clinical_text


DATES = ["12.02.22", "13.02.22", "04.06.23", "05.06.23", "08.09.24", "09.09.24"]
HEADER = "Testbezeichnung\tToleranz\tEinheit\t" + "\t".join(DATES)
LEGEND = (
    "Den Werten sind ggf. Grenzwertindikatoren '+', '++', '!+' (erhöht), "
    "'-', '--', '!-' (erniedrigt) oder '!' (auffällig) vorangestellt."
)


def row(name, reference, unit, values):
    assert len(values) == len(DATES)
    return "\t".join([name, reference, unit, *values]) + " |"


def labs(text):
    draft = parse_clinical_text(text)
    assert draft.document_type == "laboratory_report"
    assert all(candidate.target == "lab_result" for candidate in draft.candidates)
    return draft


def test_sparse_dates_and_repeated_values_survive_all_four_pages():
    source = "\f".join([
        "Erstellt am 01.01.2025\n" + HEADER + "\nBLUTBILD\n" +
        row("AA  Example count", "1 - 9", "G/l", ["4,2", "4,2", "", "5,1", "", "6,3"]),
        HEADER + "\nCHEMIE\n" + row("BB  Example enzyme", "bis 80", "U/l", ["", "", "21", "", "22", ""]),
        HEADER + "\nHORMONE\n" + row("CC  Example hormone", "ab 2", "ng/ml", ["", "", "3", "", "4", ""]),
        "HORMONE\n" + row("DD  Example ratio", "", "", ["", "", "1,2", "", "1,3", ""]) + "\n" + LEGEND,
    ])
    draft = labs(source)
    assert not draft.warnings
    assert len(draft.candidates) == 10
    assert [c.source.page for c in draft.candidates] == [1] * 4 + [2] * 2 + [3] * 2 + [4] * 2
    assert [c.normalized["measured_on"] for c in draft.candidates[:4]] == [
        "2022-02-12", "2022-02-13", "2023-06-05", "2024-09-09",
    ]
    assert [c.normalized["numeric_result"] for c in draft.candidates[:4]] == [4.2, 4.2, 5.1, 6.3]
    assert draft.candidates[0].normalized["source_analyte_code"] == "AA"
    assert draft.candidates[0].normalized["analyte_name"] == "Example count"
    assert draft.candidates[0].source.text == source.splitlines()[3]


@pytest.mark.parametrize(("token", "number", "flag"), [
    ("-1,25", 1.25, "low"), ("--1,25", 1.25, "low"), ("!-1,25", 1.25, "low"),
    ("+9,25", 9.25, "high"), ("++9,25", 9.25, "high"), ("!+9,25", 9.25, "high"),
    ("!4,25", 4.25, "abnormal"),
])
def test_prefix_flags_require_the_document_legend(token, number, flag):
    draft = labs(HEADER + "\n" + row("XX  Example", "2 - 8", "mg/l", [token, "", "", "", "", ""]) + "\n" + LEGEND)
    normalized = draft.candidates[0].normalized
    assert normalized["numeric_result"] == number
    assert normalized["source_result_text"] == token
    assert normalized["result_text"] == token.lstrip("!+-")
    assert normalized["abnormal_flag"] == flag


def test_without_legend_signed_values_are_preserved_and_need_confirmation():
    candidate = labs(HEADER + "\n" + row("Base excess", "-4 - 4", "mmol/l", ["-2,1", "", "", "", "", ""])).candidates[0]
    assert candidate.normalized["numeric_result"] == -2.1
    assert not candidate.selected
    assert "laboratory_signed_result_requires_confirmation" in candidate.normalized["review_reasons"]


@pytest.mark.parametrize(("unit", "expected", "review"), [
    ("G/1", "G/l", False), ("pg/m]", "pg/ml", False), ("U/ml]", "U/ml", False),
    ("mmo1/mo1", "mmol/mol", False), ("9/1", "9/1", True),
    ("yg/1", "yg/1", True), ("kA", "kA", True),
])
def test_units_keep_original_and_do_not_invent_missing_prefixes(unit, expected, review):
    candidate = labs(HEADER + "\n" + row("Example", "bis 7", unit, ["4,123", "", "", "", "", ""])).candidates[0]
    assert candidate.normalized["numeric_result"] == 4.123
    assert candidate.normalized["reference_high"] == 7
    assert candidate.normalized["unit"] == expected
    assert candidate.normalized["source_unit"] == unit
    assert candidate.selected is not review


def test_decimal_comparator_and_reference_limits_keep_their_roles():
    candidate = labs(HEADER + "\n" + row("Example", "ab 0,120", "ng/ml", ["<0, 750", "", "", "", "", ""])).candidates[0]
    assert candidate.normalized["numeric_result"] == .75
    assert candidate.normalized["comparator"] == "<"
    assert candidate.normalized["reference_low"] == .12
    assert candidate.normalized["reference_high"] is None


def test_ambiguous_compacted_row_cannot_shift_results_into_earlier_dates():
    draft = labs(HEADER + "\nExample\t1 - 9\tmg/l\t3,1\t4,1")
    assert draft.candidates == []
    assert any("ambiguous column" in warning for warning in draft.warnings)


def test_invalid_date_and_unreadable_result_require_review():
    header = HEADER.replace("04.06.23", "31.02.23")
    draft = labs(header + "\n" + row("Example", "1 - 9", "mg/l", ["3,1", "", "illegible", "", "", ""]))
    assert len(draft.candidates) == 2
    assert all(not c.selected for c in draft.candidates)
    assert draft.candidates[1].normalized["measured_on"] is None
    assert draft.candidates[1].normalized["numeric_result"] is None
    assert draft.warnings


def test_unrelated_next_page_does_not_inherit_table_dates():
    draft = parse_clinical_text(HEADER + "\n" + row("Example", "", "", ["3", "", "", "", "", ""]) +
        "\fDiagnosen\nArterielle Hypertonie\nMedikation\nKeine")
    assert len([c for c in draft.candidates if c.target == "lab_result"]) == 1
    assert any(c.target == "diagnosis" for c in draft.candidates)


def test_generic_longitudinal_deduplication_includes_the_date():
    draft = parse_clinical_text(
        "Laborwerte\nParameter        Einheit    Referenz       01.08.2021   03.08.2021\n"
        "Hämoglobin       g/dl       12-15          14,1         14,1"
    )
    assert len(draft.candidates) == 2
    assert {c.normalized["measured_on"] for c in draft.candidates} == {"2021-08-01", "2021-08-03"}


def test_grid_detection_uses_rules_instead_of_text_and_handles_shifted_pages():
    for shift in (0, 17):
        image = Image.new("L", (1000, 800), 255)
        draw = ImageDraw.Draw(image)
        borders = [320, 430, 550, 650, 750, 850, 950]
        for x in borders:
            for y in range(130, 690, 28):
                draw.line((x + shift, y, x + shift, y + 19), fill=0, width=2)
        actual = ruled_history_columns(image)
        assert len(actual) == len(borders)
        assert all(abs(found - expected - shift) <= 1 for found, expected in zip(actual, borders))
        image.close()
    assert ruled_history_columns(Image.new("L", (1000, 800), 255)) == []


def test_rule_cleanup_preserves_dense_legend_characters():
    image = Image.new("L", (1000, 400), 255)
    draw = ImageDraw.Draw(image)
    draw.line((20, 100, 980, 100), fill=0, width=2)
    # Many short glyph-like strokes exceed the old 35% ink threshold.
    for x in range(20, 980, 10):
        draw.rectangle((x, 200, x + 4, 211), fill=0)
    cleaned, removed = _remove_table_rules(image)
    assert removed >= 2
    assert cleaned.getpixel((500, 100)) == 255
    assert cleaned.crop((0, 190, 1000, 220)).tobytes() == image.crop((0, 190, 1000, 220)).tobytes()


def test_printed_flag_conflicting_with_reference_requires_review():
    candidate = labs(HEADER + "\n" + row("Example", "2 - 8", "mg/l", ["-4,2", "", "", "", "", ""]) + "\n" + LEGEND).candidates[0]
    assert candidate.normalized["result_text"] == "4,2"
    assert candidate.normalized["source_result_text"] == "-4,2"
    assert candidate.normalized["abnormal_flag"] == "low"
    assert not candidate.selected
    assert "laboratory_marker_reference_conflict" in candidate.normalized["review_reasons"]


def test_grid_ocr_preserves_empty_cells_and_exact_evidence_offsets():
    borders = [300, 400, 500, 600, 700, 800]
    words = [(10, "XX"), (80, "Example"), (315, "bis"), (350, "9"), (415, "mg/l"), (715, "4,2")]
    data = {
        "text": [t for _, t in words], "left": [x for x, _ in words],
        "top": [100] * 6, "width": [20, 100, 25, 10, 50, 40], "height": [20] * 6,
        "conf": [95] * 6, "block_num": [1] * 6, "par_num": [1] * 6, "line_num": [1] * 6,
    }
    outcome = _outcome_from_grid_data(data, "deu+eng", borders)
    assert outcome.text == "XX  Example\tbis 9\tmg/l\t\t\t4,2 |"
    assert [outcome.text[b.start_char:b.end_char] for b in outcome.blocks] == ["XX  Example", "bis 9", "mg/l", "4,2"]
    scaled = _rescale_ocr_blocks(outcome, .5, .5)
    assert scaled.blocks[-1].bbox == (358, 50, 20, 10)
    assert scaled.text == outcome.text
