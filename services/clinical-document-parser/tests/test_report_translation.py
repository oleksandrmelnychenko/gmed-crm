"""Synthetic regressions for native English reports; no patient PDF fixtures."""
import json
from types import SimpleNamespace

import pytest

from app.extraction import _extract_native_page_text
from app.parser import parse_clinical_text
from app import translation
from app.translation_segments import reflow_translation_text, repair_medical_term_renderings, repair_untranslated_terms, restore_decimal_spelling
from app.rules import load_rules


@pytest.mark.parametrize("plain,layout", [
    ("Height 172.4 cm", "Height 1 72.4 cm"),
    ("Diagnosis 09/2022", "Diagnosis 0 9/2022"),
    ("History 2018", "History 20 18"),
    ("Dose 1.25 mg", "Dose 1. 25 mg"),
])
def test_native_layout_cannot_split_numbers(plain, layout):
    page = SimpleNamespace(extract_text=lambda **kwargs: layout if kwargs else plain)
    assert _extract_native_page_text(page) == plain


def test_native_table_layout_is_retained_when_numbers_are_unchanged():
    plain = "A B\n2 3\n4 5"
    layout = "A\t2\t4\nB\t3\t5"
    page = SimpleNamespace(extract_text=lambda **kwargs: layout if kwargs else plain)
    assert _extract_native_page_text(page) == layout


def test_wrapped_vitals_keep_pressure_unit_and_english_pulse_rate():
    draft = parse_clinical_text("Medical Summary\nHeight 172.4 cm, body weight 63.2 kg, blood pressure 110/70\nmmHg, pulse rate 72/min, oxygen saturation 98.5%.")
    vitals = [c for c in draft.candidates if c.target == 'vital']
    assert len(vitals) == 1
    for key, value in dict(height_cm=172.4, weight_kg=63.2, bp_systolic=110, bp_diastolic=70, heart_rate=72, oxygen_saturation=98.5).items():
        assert vitals[0].normalized[key] == value
    assert 'ambiguous_unit:blood_pressure' not in vitals[0].normalized['review_reasons']
    assert 'missing_measured_at' in vitals[0].normalized['review_reasons']
    assert not vitals[0].selected


@pytest.mark.parametrize('separator', ['\n\n', '\f'])
def test_vital_unit_does_not_attach_across_paragraph_or_page(separator):
    draft = parse_clinical_text('Report Summary\nMedical Summary\nThe patient presented for examination and further monitoring.\nBlood pressure 110/70' + separator + 'mmHg, pulse rate 72/min.')
    pressure = next(c for c in draft.candidates if c.target == 'vital' and 'bp_systolic' in c.normalized)
    assert 'ambiguous_unit:blood_pressure' in pressure.normalized['review_reasons']


@pytest.mark.skipif(not (translation.MODEL_DIRECTORY / 'model/model.bin').exists(), reason='local model not installed')
def test_real_model_retries_omitted_qualifier_and_keeps_ranges_and_thousands():
    pytest.importorskip('ctranslate2')
    pytest.importorskip('sentencepiece')
    draft = parse_clinical_text("Medical Summary\nThyroid function shows euthyroid, stable sero-positive autoimmune Hashimoto's thyroiditis in anti-TPO and anti-TG.\n\nRecommendations\nTarget 30–60 ng/ml. Target for B12: 1,100 pg/mL.")
    result = translation.with_german_translation(draft)
    assert result.translation.status == 'review_required'
    assert result.translation.warnings == []
    assert len(result.translation.candidate_values) == len(draft.candidates)
    assert result.candidates == draft.candidates


def test_long_unbulleted_report_list_preserves_assertions_and_section_boundaries():
    source = """Report Summary
Diagnoses
Exclusion of thyroid nodules
Small stable thyroid cyst on the left, initially diagnosed 03/2022
Status post left knee arthroplasty 04/2018
Status post pneumonia, initially diagnosed 2017
Iron deficiency
Medical Summary
The laboratory results show no further abnormalities.

Antibodies are not detectable.
Thyroid Sonography
No additional nodules are present.
Should questions or uncertainties arise, please contact us.
Yours sincerely,
\f<Signature>
<Stamp>
Dr. Example Clinician
<Page 2 of 2>
<End of Translation. Total number of pages: 2.>
"""
    draft = parse_clinical_text(source)
    assert draft.source_language == "en"
    assert draft.document_type == "medical_report"
    assert [(c.target, c.normalized["assertion"]) for c in draft.candidates[:5]] == [
        ("examination", "rule_out"), ("diagnosis", "confirmed"),
        ("anamnesis", "historical"), ("anamnesis", "historical"),
        ("diagnosis", "confirmed"),
    ]
    assert [c.value for c in draft.candidates[5:]] == [
        "The laboratory results show no further abnormalities.",
        "Antibodies are not detectable.", "No additional nodules are present.",
    ]
    assert all(c.target == "examination" for c in draft.candidates[5:])
    assert all(c.source.page == 1 and not c.selected for c in draft.candidates)
    assert draft.raw_text == source.strip()


@pytest.mark.parametrize("text,assertion", [
    ("Exclusion of thyroid nodules", "rule_out"),
    ("Thyroid antibodies are not detectable", "negated"),
])
def test_exclusions_and_undetectable_findings_are_not_confirmed_diagnoses(text, assertion):
    draft = parse_clinical_text("Diagnoses\n" + text)
    assert [(c.target, c.normalized["assertion"]) for c in draft.candidates] == [("examination", assertion)]


def test_reflow_joins_prose_without_merging_diagnoses_tables_or_pages():
    source = ("Diagnoses\nStable thyroiditis with\npositive antibodies\nIron deficiency\n"
              "Medical Summary\nFirst sentence wraps\nonto this line. Next sentence.\n\n"
              "Parameter\tValue\nA\t4.2\fA separate page.\nYours sincerely,\nDr. Example")
    assert reflow_translation_text(source, {"diagnoses", "medical summary", "yours sincerely"}) == (
        "Diagnoses\nStable thyroiditis with positive antibodies\nIron deficiency\n"
        "Medical Summary\nFirst sentence wraps onto this line. Next sentence.\n\n"
        "Parameter\tValue\nA\t4.2\fA separate page.\nYours sincerely,\nDr. Example"
    )


@pytest.mark.parametrize("source,target,expected", [
    ("172.4 cm, 61.20 kg", "172,4 cm, 61,20 kg", "172.4 cm, 61.20 kg"),
    ("-1.25 mg", "-1,25 mg", "-1.25 mg"),
    ("1.000 mg", "1,000 mg", "1,000 mg"),
    ("1.2 mg", "1,3 mg", "1,3 mg"),
    ("1.2 and 3.4", "3,4 und 1,2", "3,4 und 1,2"),
    ("1.2 and 3.4", "1,2", "1,2"),
    ("1.2 and 3.4", "1,2 und 3,5", "1,2 und 3,5"),
    ("1,200 mg to 2,400 mg", "1.200 mg bis 2.400 mg", "1,200 mg bis 2,400 mg"),
    ("1.0; 400–600 mg; 80,000 IU", "1,0; 400-600 mg; 80.000 IE", "1.0; 400-600 mg; 80,000 IE"),
    ("1,200 mg", "1.300 mg", "1.300 mg"),
    ("1.200 mg", "1,200 mg", "1,200 mg"),
    ("-1.2 mg", "1,2 mg", "1,2 mg"),
])
def test_decimal_formatting_never_repairs_changed_or_ambiguous_numbers(source, target, expected):
    assert restore_decimal_spelling(source, target) == expected


@pytest.mark.parametrize("source,target,preserved", [
    ("40–80 ng/ml", "40-80 ng/ml", True),
    ("11%–13%", "11%-13%", True),
    ("-2.5 mg", "2.5 mg", False),
    ("−2.5", "-2.5", True),
    ("40–80 ng/ml", "40-90 ng/ml", False),
    ("40–80 ng/ml", "80-40 ng/ml", False),
])
def test_numeric_checks_distinguish_ranges_from_signed_values(source, target, preserved):
    assert translation.numbers_preserved(source, target) is preserved


@pytest.mark.parametrize("source,target,preserved", [
    ("No nodules on the right.", "Keine Knoten rechts.", True),
    ("No nodules on the right.", "Knoten rechts.", False),
    ("Nodules on the right.", "Keine Knoten rechts.", False),
    ("Nodules on the left.", "Knoten rechts.", False),
    ("Bilateral nodules.", "Beidseitige Knoten.", True),
    ("Status post left knee arthroplasty", "Zustand nach linker Kniearthroplastik", True),
    ("Status post left knee arthroplasty", "Linke Kniearthroplastik", False),
    ("Status post left knee arthroplasty", "Status post left knee arthroplasty", False),
    ("Exclusion of nodules", "Ausschluss von Knoten", True),
    ("Exclusion of nodules", "Knoten", False),
    ("Antibodies are not detectable.", "Antikörper sind nicht nachweisbar.", True),
    ("Unremarkable examination without pain.", "Unauffällige Untersuchung ohne Schmerzen.", True),
    ("Thyroid function is euthyroid.", "Die Schilddrüsenfunktion zeigt Euthyreose.", True),
    ("Thyroid function is euthyroid.", "Die Schilddrüsenfunktion zeigt Hypothyreose.", False),
])
def test_translation_checks_negation_laterality_and_history(source, target, preserved):
    assert translation.clinical_qualifiers_preserved(source, target) is preserved


def test_partial_english_laterality_blocks_adoption_without_changing_source(monkeypatch, tmp_path):
    (tmp_path / "model").mkdir()
    (tmp_path / "model/model.bin").touch()
    monkeypatch.setattr(translation, "MODEL_DIRECTORY", tmp_path)
    draft = parse_clinical_text("Diagnoses\nStatus post left knee arthroplasty")
    before = draft.model_dump()
    partial = "Status post left Kniearthroplastik"
    payload = {"text": "Diagnosen\n" + partial, "candidates": {draft.candidates[0].id: partial}}
    monkeypatch.setattr(translation.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout=json.dumps(payload)))
    result = translation.with_german_translation(draft)
    assert result.translation.status == "review_required"
    assert result.translation.warnings == ["translation_terms_changed"]
    assert result.translation.candidate_values == {}
    assert result.candidates == draft.candidates
    assert draft.model_dump() == before


@pytest.mark.skipif(not (translation.MODEL_DIRECTORY / "model/model.bin").exists(), reason="local translation model not installed")
def test_real_model_translates_wrapped_report_and_conventional_closing():
    pytest.importorskip("ctranslate2")
    pytest.importorskip("sentencepiece")
    source = ("Report Summary\nMedical Summary\nThe examination showed no\n"
              "nodules on the right. The height is 172.4 cm.\n\n"
              "Repeat the examination in 8 weeks.\nYours sincerely,\fDr. Example")
    draft = parse_clinical_text(source)
    result = translation.with_german_translation(draft)
    assert result.translation.status == "review_required"
    assert result.translation.warnings == []
    assert result.translation.text.startswith("Befundbericht\nMedizinische Zusammenfassung\n")
    assert "Mit freundlichen Grüßen\fDr. Example" in result.translation.text
    assert "172.4 cm" in result.translation.text
    assert "8 Wochen" in result.translation.text
    assert len(result.translation.candidate_values) == len(draft.candidates)
    assert result.raw_text == draft.raw_text
    assert result.candidates == draft.candidates


@pytest.mark.parametrize("source,target,expected", [
    ("Status post right hemicolectomy 11/2021", "Status post right hemicolectomy 11/2021", "Zustand nach Hemikolektomie rechts 11/2021"),
    ("Status post left hemicolectomy", "status post left hemicolectomy", "Zustand nach Hemikolektomie links"),
    ("Status post hemicolectomy", "Status post right hemicolectomy", "Status post right hemicolectomy"),
    ("No surgery", "Status post right hemicolectomy", "Status post right hemicolectomy"),
    ("Status post right hemicolectomy", "Zustand nach Hemikolektomie links", "Zustand nach Hemikolektomie links"),
])
def test_glossary_requires_source_evidence_and_an_untranslated_whole_phrase(source, target, expected):
    assert repair_untranslated_terms(source, target, load_rules()["translation_terms"]) == expected


@pytest.mark.skipif(not (translation.MODEL_DIRECTORY / "model/model.bin").exists(), reason="local translation model not installed")
def test_real_model_preserves_surgical_history_and_side_with_glossary():
    pytest.importorskip("ctranslate2")
    pytest.importorskip("sentencepiece")
    draft = parse_clinical_text("Diagnoses\nStatus post right hemicolectomy 11/2021 (exclusion of malignancy)")
    result = translation.with_german_translation(draft)
    assert result.translation.warnings == []
    value = result.translation.candidate_values[draft.candidates[0].id]
    assert "Hemikolektomie" in value and "rechts" in value
    assert "Ausschluss" in value and "11/2021" in value
    assert result.candidates == draft.candidates


@pytest.mark.parametrize("source,target,expected", [
    ("exclusion of malignancy in ascending colon adenoma", "Ausschluss von Malignität bei aufsteigendem Kolonadenom", "Ausschluss von Malignität bei einem Adenom des Colon ascendens"),
    ("A small solitary reactive lymph node", "Ein kleiner einsamen reaktiven Lymphknoten", "Ein kleiner solitären reaktiven Lymphknoten"),
    ("descending colon adenoma", "bei aufsteigendem Kolonadenom", "bei aufsteigendem Kolonadenom"),
    ("multiple reactive lymph nodes", "einsamen reaktiven Lymphknoten", "einsamen reaktiven Lymphknoten"),
])
def test_terminology_repairs_require_exact_source_and_target_terms(source, target, expected):
    assert repair_medical_term_renderings(source, target, load_rules()["translation_term_repairs"]) == expected


def test_colon_segment_and_solitary_finding_cannot_silently_change():
    assert not translation.clinical_qualifiers_preserved("ascending colon adenoma", "aufsteigendes Kolonadenom")
    assert translation.clinical_qualifiers_preserved("ascending colon adenoma", "Adenom des Colon ascendens")
    assert not translation.clinical_qualifiers_preserved("solitary reactive lymph node", "einsamer reaktiver Lymphknoten")
    assert translation.clinical_qualifiers_preserved("solitary reactive lymph node", "solitärer reaktiver Lymphknoten")


@pytest.mark.skipif(not (translation.MODEL_DIRECTORY / "model/model.bin").exists(), reason="local translation model not installed")
def test_real_model_preserves_colon_segment_in_surgical_history():
    pytest.importorskip("ctranslate2")
    pytest.importorskip("sentencepiece")
    draft = parse_clinical_text("Diagnoses\nStatus post right hemicolectomy 11/2021 (exclusion of malignancy in ascending colon adenoma)")
    result = translation.with_german_translation(draft)
    assert result.translation.warnings == []
    assert "Colon ascendens" in result.translation.candidate_values[draft.candidates[0].id]
