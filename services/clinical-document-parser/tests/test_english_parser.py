import pytest

from app.english_dates import normalize_english_date
from app.parser import parse_clinical_text
from app.rules import load_rules


def test_english_discharge_sections_keep_source_and_require_review():
    draft = parse_clinical_text("""Discharge summary
Patient name: Alice Example
Date of birth: 14 March 1980
MRN: EXT-1234
Discharge diagnoses
1. Essential hypertension
2. Suspected pneumonia
Past medical history
Appendectomy in 2010.
Physical examination
The patient is alert and oriented.
Current medications
None
Recommendations
Follow up with the cardiologist.
""")
    assert draft.source_language == "en"
    assert draft.document_type == "discharge_summary"
    assert draft.subject.first_name == "Alice"
    assert draft.subject.birth_date == "1980-03-14"
    assert draft.subject.patient_identifier_namespace == "source_document"
    assert {item.target for item in draft.candidates} == {"diagnosis", "anamnesis", "examination", "recommendation"}
    assert all(not item.selected for item in draft.candidates)
    assert all(item.value == item.source.text for item in draft.candidates)
    assert next(item for item in draft.candidates if item.value == "Suspected pneumonia").normalized["assertion"] == "suspected"


@pytest.mark.parametrize(("text", "target", "assertion"), [
    ("No evidence of pneumonia", "examination", "negated"),
    ("Pulmonary embolism ruled out", "examination", "negated"),
    ("Rule out pulmonary embolism", "examination", "rule_out"),
    ("Possible pneumonia", "diagnosis", "suspected"),
    ("Pneumonia cannot be excluded", "diagnosis", "suspected"),
    ("Cannot rule out pneumonia", "diagnosis", "suspected"),
    ("Pneumonia not ruled out", "diagnosis", "suspected"),
    ("Pneumonia cannot be ruled out", "diagnosis", "suspected"),
    ("History of myocardial infarction", "anamnesis", "historical"),
    ("Family history of diabetes", "anamnesis", "family_history"),
    ("Diabetes without complications", "diagnosis", "confirmed"),
])
def test_english_assertions_are_not_confirmed_diagnoses(text, target, assertion):
    draft = parse_clinical_text(f"Diagnoses\n{text}")
    assert len(draft.candidates) == 1
    item = draft.candidates[0]
    assert (item.target, item.normalized["assertion"]) == (target, assertion)
    assert not item.selected


def test_english_pages_and_medication_status_are_preserved():
    draft = parse_clinical_text("\f\fCurrent medications\nGeneric name\tStrength\tStatus\nMetformin\t500 mg\tstopped")
    medication = next(item for item in draft.candidates if item.target == "medication")
    assert medication.source.page == 3
    assert medication.normalized["wirkstoff"] == "Metformin"
    assert medication.normalized["staerke"] == "500 mg"
    assert medication.normalized["status"] == "abgesetzt"
    assert not medication.selected


@pytest.mark.parametrize(("raw", "expected"), [
    ("1980-03-14", "1980-03-14"), ("March 14, 1980", "1980-03-14"),
    ("14 Mar 1980", "1980-03-14"), ("03/14/1980", "1980-03-14"),
    ("14/03/1980", "1980-03-14"), ("03/04/1980", None),
    ("31 February 1980", None), ("19xx-03-14", None),
])
def test_english_dates_do_not_guess_us_or_uk_order(raw, expected):
    assert normalize_english_date(raw) == expected


def test_ambiguous_birth_date_keeps_identity_review_gate():
    subject = parse_clinical_text("Patient name: Alice Example\nDOB: 03/04/1980\nDiagnoses\nHypertension").subject
    assert subject.birth_date is None
    assert subject.conflict


def test_rules_merge_document_hints_instead_of_overwriting_german_profiles():
    hints = load_rules()["document_type_hints"]["cardiology_report"]
    assert "Kardiologie" in hints
    assert "Cardiology" in hints


def test_wrapped_english_letter_separates_diagnoses_findings_and_therapy():
    # Synthetic prose with PDF wrapping and pharmacy footnotes. No private
    # patient document is committed as a regression fixture.
    draft = parse_clinical_text('''c/o Mr. Example Contact
Diagnoses:
Stable autoimmune thyroiditis with
positive antibodies. Vitamin B7 deficiency.
Normal vitamin D supply with elevated ratio.
Therapeutically improved lipid index.

Summary:
The patient reports improved general well-being.

Laboratory
Ferritin was 170 ng/ml in 2021. The target is 90 ng/ml.
\fDoctor's letter dated January 1, 26                         2
Laboratory values remain under review.

Conclusion
Repeat the examination in 6 weeks.
\fDoctor's letter dated January 1, 26                         3
Therapy recommendations (or similar, see below)
I. Available in pharmacies with a prescription.

II. Not pharmacy-only supplements.

Vitamin B7 4–8 mg per day,
regardless of when.

Selenium 100 μg per day, ideally in the

morning.

Product A (one capsule) or Product B (two capsules).

I am available to answer questions and arrange further appointments.
With warm regards,
Dr. Example Clinician
''')
    assert draft.source_language == "en"
    assert draft.subject is None
    diagnoses = [c for c in draft.candidates if c.target == "diagnosis"]
    assert [c.value for c in diagnoses] == [
        "Stable autoimmune thyroiditis with positive antibodies.", "Vitamin B7 deficiency.",
    ]
    findings = [c.value for c in draft.candidates if c.target == "examination"]
    assert "Normal vitamin D supply with elevated ratio." in findings
    assert "Therapeutically improved lipid index." in findings
    assert not any(c.target in {"lab_result", "medication"} for c in draft.candidates)
    therapy = [c for c in draft.candidates if c.source.page == 3]
    assert [c.value for c in therapy] == [
        "Vitamin B7 4–8 mg per day, regardless of when.",
        "Selenium 100 μg per day, ideally in the morning.",
        "Product A (one capsule) or Product B (two capsules).",
    ]
    assert all(c.target == "recommendation" for c in therapy)
    assert "\n" in therapy[0].source.text
    assert not any(c.selected for c in draft.candidates)
    assert not any("letter dated" in c.value or "Example Clinician" in c.value for c in draft.candidates)


def test_short_english_diagnosis_list_retains_separate_entries():
    draft = parse_clinical_text("Diagnoses\nHypertension\nDiabetes mellitus")
    assert [c.value for c in draft.candidates] == ["Hypertension", "Diabetes mellitus"]
