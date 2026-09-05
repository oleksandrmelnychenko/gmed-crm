"""Image-backed refinement cannot edit measurements or invent missing units."""
from copy import deepcopy
import time

from PIL import Image
import pytest
import pytesseract

from app.lab_grid import refine_unit_cells
from app.parser import parse_clinical_text


def data_for(unit):
    words = [(10, "TEST"), (80, "Example"), (320, "2,0-9,0"), (410, unit), (520, "4,5")]
    return {
        "text": [text for _, text in words], "conf": [60] * len(words),
        "left": [left for left, _ in words], "top": [50] * len(words),
        "width": [40] * len(words), "height": [16] * len(words),
        "block_num": [1] * len(words), "par_num": [1] * len(words), "line_num": [1] * len(words),
    }


@pytest.mark.parametrize("original,alternate,expected,language", [
    ("9/1", "g/l", "g/l", "deu"),
    ("yg/1", "ug/1", "ug/1", "eng"),
    ("yg/1", "ng/l", "yg/1", "eng"),
    ("9/1", "mg/l", "9/1", "deu"),
    ("yumol/mmol Chol", "umol/mmol Cho]", "umol/mmol Cho]", "deu"),
])
def test_refinement_uses_only_matching_unit_cell_glyphs(monkeypatch, original, alternate, expected, language):
    data = data_for(original)
    before = deepcopy(data)
    deadline = time.monotonic() + 10
    def reread(image, **kwargs):
        assert image.width in {(500 - 400 - 14), (500 - 400 - 14) * 2}
        assert image.height in {(16 + 16), (16 + 16) * 2}
        assert kwargs["lang"] == language
        assert 0 < kwargs["timeout"] <= 3
        assert kwargs["config"].endswith("--psm 7")
        return {"text": alternate.split(), "conf": [90] * len(alternate.split())}
    monkeypatch.setattr(pytesseract, "image_to_data", reread)
    with Image.new("L", (900, 100)) as image:
        refine_unit_cells(image, data, [300, 400, 500, 600, 700, 800], "deu+eng", deadline)
    assert data["text"][3] == expected
    for key in data:
        assert data[key][:3] == before[key][:3]
        assert data[key][4:] == before[key][4:]
    assert data["conf"][3] <= before["conf"][3]


@pytest.mark.parametrize("unit", ["g/l", "g/1", "ug/1", "ng/l", "kA", "", "mg/dl"])
def test_valid_or_unspecified_units_do_not_trigger_repair(monkeypatch, unit):
    data = data_for(unit)
    before = deepcopy(data)
    monkeypatch.setattr(pytesseract, "image_to_data", lambda *a, **k: pytest.fail("Must not infer a unit"))
    with Image.new("L", (900, 100)) as image:
        refine_unit_cells(image, data, [300, 400, 500, 600, 700, 800], "deu+eng", time.monotonic() + 10)
    assert data == before


def test_optional_refinement_timeout_preserves_first_pass(monkeypatch):
    data = data_for("9/1")
    before = deepcopy(data)
    def timeout(*args, **kwargs):
        raise RuntimeError("Tesseract process timeout")
    monkeypatch.setattr(pytesseract, "image_to_data", timeout)
    with Image.new("L", (900, 100)) as image:
        refine_unit_cells(image, data, [300, 400, 500, 600, 700, 800], "deu+eng", time.monotonic() + 10)
    assert data == before


def test_second_scale_can_recover_glyph_without_guessing(monkeypatch):
    data = data_for("9/1")
    sizes = []
    def reread(image, **kwargs):
        sizes.append(image.width)
        return {"text": ["g/" if len(sizes) == 1 else "g/l"], "conf": [45]}
    monkeypatch.setattr(pytesseract, "image_to_data", reread)
    with Image.new("L", (900, 100)) as image:
        refine_unit_cells(image, data, [300, 400, 500, 600, 700, 800], "deu+eng", time.monotonic() + 10)
    assert data["text"][3] == "g/l"
    assert sizes == [172, 86]


@pytest.mark.parametrize("languages,remaining", [("eng", 10), ("deu+eng", -1)])
def test_refinement_respects_languages_and_page_deadline(monkeypatch, languages, remaining):
    data = data_for("9/1")
    before = deepcopy(data)
    monkeypatch.setattr(pytesseract, "image_to_data", lambda *a, **k: pytest.fail("Unavailable refinement"))
    with Image.new("L", (900, 100)) as image:
        refine_unit_cells(image, data, [300, 400, 500, 600, 700, 800], languages, time.monotonic() + remaining)
    assert data == before


@pytest.mark.parametrize("alternate,expected", [(["FAI", "FAI"], "FAI"), (["FAL", "FAI"], "FAL")])
def test_short_label_requires_code_and_name_to_agree_in_image_reread(monkeypatch, alternate, expected):
    data = data_for("")
    data["text"][:2] = ["FAL", "FAL"]
    monkeypatch.setattr(pytesseract, "image_to_data", lambda *a, **k: {"text": alternate, "conf": [90, 90]})
    with Image.new("L", (900, 100)) as image:
        refine_unit_cells(image, data, [300, 400, 500, 600, 700, 800], "deu+eng", time.monotonic() + 10)
    assert data["text"][:2] == [expected, expected]
    assert data["text"][2:] == ["2,0-9,0", "", "4,5"]


@pytest.mark.parametrize("source,expected", [("HbAlc", "HbA1c"), ("Betal-Globulin", "Beta1-Globulin"), ("Unlisted marker", "Unlisted marker")])
def test_known_name_normalization_keeps_original_label_and_evidence(source, expected):
    text = "Testbezeichnung\tToleranz\tEinheit\t01.02.22\t02.02.22\t03.02.22\n" + f"XX  {source}\t2-9\tg/l\t4,5\t\t |"
    draft = parse_clinical_text(text)
    item = draft.candidates[0]
    assert item.normalized["analyte_name"] == expected
    assert item.normalized["source_analyte_name"] == source
    assert item.source.text == text.splitlines()[1]
    assert item.normalized["numeric_result"] == 4.5


@pytest.mark.parametrize("unit,expected", [("ug/1", "µg/l"), ("umol/mmol Cho]", "µmol/mmol Chol"), ("g/1", "g/l")])
def test_supported_unit_spelling_retains_source_prefix(unit, expected):
    text = "Testbezeichnung\tToleranz\tEinheit\t01.02.22\t02.02.22\t03.02.22\n" + f"XX  Example\t2-9\t{unit}\t4,5\t\t |"
    item = parse_clinical_text(text).candidates[0]
    assert item.normalized["source_unit"] == unit
    assert item.normalized["unit"] == expected
