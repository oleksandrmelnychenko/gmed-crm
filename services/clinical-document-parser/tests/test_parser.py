from app.parser import parse_clinical_text


CARDIOLOGY_TEXT = """
Diagnosen
Internistisch kardiologische Kontrolluntersuchung
beginnende LV-Hypertrophie
Ausschluss Herzinsuffizienz
Steatosis hepatis
Vitamin D Mangel

Anamnese
Der Patient stellt sich zur Kontrolle vor. Keine Dyspnoe, keine Dauermedikation.

Echokardiographie
Leichte LV-Hypertrophie. LV-EF 58 %. Keine regionalen Wandbewegungsstörungen.

Empfehlung
Der Vitamin-D-Mangel sollte oral ausgeglichen und der Blutdruck kontrolliert werden.
"""


def test_cardiology_report_creates_review_candidates() -> None:
    draft = parse_clinical_text(CARDIOLOGY_TEXT)

    assert draft.document_type == "cardiology_report"
    assert draft.source_language == "de"
    diagnoses = [item for item in draft.candidates if item.target == "diagnosis"]
    assert [item.value for item in diagnoses] == [
        "beginnende LV-Hypertrophie",
        "Steatosis hepatis",
        "Vitamin D Mangel",
    ]
    assert all(item.normalized["assertion"] == "confirmed" for item in diagnoses)
    encounter = next(
        item
        for item in draft.candidates
        if item.normalized.get("semantic_role") == "encounter"
    )
    assert encounter.target == "examination"
    assert encounter.selected is True
    rule_out = next(
        item
        for item in draft.candidates
        if item.normalized.get("assertion") == "rule_out"
    )
    assert rule_out.target == "examination"
    assert rule_out.selected is False
    assert rule_out.source.text == "Ausschluss Herzinsuffizienz"
    assert any(item.target == "anamnesis" for item in draft.candidates)
    assert any(item.target == "examination" for item in draft.candidates)
    assert any(item.target == "recommendation" for item in draft.candidates)


def test_truncated_ocr_anamnese_heading_is_recovered_from_context() -> None:
    text = """
Diagnosen
Internistisch kardiologische Kontrolluntersuchung
beginnende LV-Hypertrophie
Ana
Herr Mustermann stellt sich zur Kontrolle und Vorsorgeuntersuchung vor. Beschwerden wie
Angina pectoris, Schwindel, Synkopen oder Palpitationen werden verneint. Keine Dyspnoe.
Befund
Untersuchungen
HerztГ¶ne rein, regelmГ¤Гџig. Pulmo frei.
"""

    draft = parse_clinical_text(text)

    diagnoses = [item.value for item in draft.candidates if item.target == "diagnosis"]
    anamnesis = [item.value for item in draft.candidates if item.target == "anamnesis"]
    assert diagnoses == ["beginnende LV-Hypertrophie"]
    assert any(
        item.target == "examination"
        and item.normalized.get("semantic_role") == "encounter"
        and item.value == "Internistisch kardiologische Kontrolluntersuchung"
        for item in draft.candidates
    )
    assert anamnesis == [
        "Herr Mustermann stellt sich zur Kontrolle und Vorsorgeuntersuchung vor. Beschwerden wie\n"
        "Angina pectoris, Schwindel, Synkopen oder Palpitationen werden verneint. Keine Dyspnoe."
    ]


def test_standalone_ana_lab_term_is_not_misclassified_as_anamnesis() -> None:
    text = """
Diagnosen
ANA
1:160, homogenes Fluoreszenzmuster
Untersuchungen
Kontrolllabor empfohlen.
"""

    draft = parse_clinical_text(text)

    assert not [item for item in draft.candidates if item.target == "anamnesis"]
    assert [item.value for item in draft.candidates if item.target == "diagnosis"] == [
        "ANA",
        "1:160, homogenes Fluoreszenzmuster",
    ]


def test_explicit_no_medication_does_not_create_a_drug() -> None:
    draft = parse_clinical_text("Medikation\nKeine Dauermedikation")

    assert not [item for item in draft.candidates if item.target == "medication"]
    assert any("negation" in warning.lower() for warning in draft.warnings)


def test_no_regular_medication_does_not_hide_a_separate_prn_row() -> None:
    draft = parse_clinical_text(
        "Medikation\nKeine Dauermedikation\nPainAway (Ibuprofen) 400 mg bei Bedarf"
    )

    medications = [item for item in draft.candidates if item.target == "medication"]
    assert len(medications) == 1
    assert medications[0].normalized["wirkstoff"] == "Ibuprofen"
    assert medications[0].normalized["as_needed"] is True


def test_bmp_medication_table_creates_structured_safe_candidates() -> None:
    text = """
Deutschland
Bundeseinheitlicher Medikationsplan vom 01.08.2026
Wirkstoff\tHandelsname\tStärke\tForm\tMorgens\tMittags\tAbends\tNachts\tEinheit\tATC\tPZN
Metformin\tGlucophage\t500 mg\tTablette\t1\t0\t1\t0\tStück\tA10BA02\t01234567
"""

    draft = parse_clinical_text(text)
    medications = [item for item in draft.candidates if item.target == "medication"]

    assert len(medications) == 1
    row = medications[0]
    assert row.selected is False
    assert row.normalized["raw_text"].startswith("Metformin\tGlucophage")
    assert row.normalized["wirkstoff"] == "Metformin"
    assert row.normalized["handelsname"] == "Glucophage"
    assert row.normalized["staerke"] == "500 mg"
    assert row.normalized["form"] == "Tablette"
    assert row.normalized["einnahmeform"] == "oral"
    assert [
        row.normalized["dose_morgens"],
        row.normalized["dose_mittags"],
        row.normalized["dose_abends"],
        row.normalized["dose_nachts"],
    ] == ["1", "0", "1", "0"]
    assert row.normalized["einheit"] == "Stück"
    assert row.normalized["source_date"] == "2026-08-01"
    assert row.normalized["source_country"] == "DE"
    assert row.normalized["identifiers"] == {"atc": "A10BA02", "pzn": "01234567"}
    assert row.normalized["field_confidence"]["wirkstoff"] == 0.98
    assert row.normalized["field_evidence"]["wirkstoff"] == "labeled_table_cell"
    assert row.normalized["auto_select"] is False
    assert row.normalized["field_confidence"]["status"] == 0.65
    assert row.normalized["field_evidence"]["status"] == (
        "structured_current_medication_table_without_explicit_status"
    )
    assert "medication_active_status_requires_confirmation" in row.normalized["review_reasons"]
    assert not [item for item in draft.candidates if item.target == "lab_result"]


def test_brand_only_medication_requires_active_ingredient_review() -> None:
    draft = parse_clinical_text("Medikation\nBeispielpräparat 20 mg 1-0-0")

    row = next(item for item in draft.candidates if item.target == "medication")
    assert row.normalized["wirkstoff"] is None
    assert row.normalized["handelsname"] == "Beispielpräparat"
    assert row.normalized["dose_morgens"] == "1"
    assert row.normalized["auto_select"] is False
    assert row.selected is False
    assert "active_ingredient_requires_confirmation" in row.normalized["review_reasons"]
    assert "medication_active_status_requires_confirmation" in row.normalized["review_reasons"]


def test_medication_parenthetical_ingredient_prn_and_lifecycle_are_preserved() -> None:
    text = """
Medikation
CardioX (Bisoprolol) 5 mg 1-0-0-0, pausiert seit 03.08.2026 bis 10.08.2026
PainAway (Ibuprofen) 400 mg bei Bedarf, abgesetzt am 02.08.2026
"""

    draft = parse_clinical_text(text)
    medications = [item for item in draft.candidates if item.target == "medication"]

    assert len(medications) == 2
    paused, stopped = medications
    assert paused.normalized["wirkstoff"] == "Bisoprolol"
    assert paused.normalized["status"] == "pausiert"
    assert paused.normalized["on_hold"] is True
    assert paused.normalized["hold_from"] == "2026-08-03"
    assert paused.normalized["hold_until"] == "2026-08-10"
    assert paused.selected is False
    assert stopped.normalized["wirkstoff"] == "Ibuprofen"
    assert stopped.normalized["status"] == "abgesetzt"
    assert stopped.normalized["einnahme_bis"] == "2026-08-02"
    assert stopped.normalized["as_needed"] is True
    assert stopped.normalized["category"] == "besondere"
    assert stopped.selected is False


def test_medication_free_text_dates_and_identifiers_are_structured() -> None:
    text = """
Medikation
Wirkstoff: Apixaban, Handelsname: Eliquis, 5 mg, verordnet am 01.07.2026, Einnahmebeginn 02.07.2026, ATC: B01AF02, PZN: 01234567
"""

    draft = parse_clinical_text(text)
    row = next(item for item in draft.candidates if item.target == "medication")

    assert row.normalized["wirkstoff"] == "Apixaban"
    assert row.normalized["handelsname"] == "Eliquis"
    assert row.normalized["verordnet_am"] == "2026-07-01"
    assert row.normalized["einnahme_von"] == "2026-07-02"
    assert row.normalized["identifiers"] == {"atc": "B01AF02", "pzn": "01234567"}
    assert row.normalized["auto_select"] is False
    assert row.selected is False
    assert row.normalized["field_evidence"]["status"] == "active_status_inferred_only_by_absence"
    assert "medication_active_status_requires_confirmation" in row.normalized["review_reasons"]


def test_explicit_active_medication_status_can_be_safely_selected() -> None:
    draft = parse_clinical_text(
        "Medikation\nCardioX (Bisoprolol) 5 mg 1-0-0-0, Status: aktiv"
    )

    row = next(item for item in draft.candidates if item.target == "medication")
    assert row.normalized["wirkstoff"] == "Bisoprolol"
    assert row.normalized["status"] == "aktiv"
    assert row.normalized["field_confidence"]["status"] == 0.97
    assert row.normalized["field_evidence"]["status"] == "explicit_active_status"
    assert "medication_active_status_requires_confirmation" not in row.normalized["review_reasons"]
    assert row.normalized["auto_select"] is True
    assert row.selected is True


def test_current_medication_heading_without_explicit_status_stays_unselected() -> None:
    draft = parse_clinical_text(
        "Aktuelle Medikation\nCardio Aktiv (Bisoprolol) 5 mg 1-0-0-0"
    )

    row = next(item for item in draft.candidates if item.target == "medication")
    assert row.normalized["wirkstoff"] == "Bisoprolol"
    assert row.normalized["status"] == "aktiv"
    assert row.normalized["field_evidence"]["status"] == (
        "explicit_current_medication_section_without_explicit_status"
    )
    assert "medication_active_status_requires_confirmation" in row.normalized["review_reasons"]
    assert row.normalized["auto_select"] is False
    assert row.selected is False


def test_unknown_layout_is_reviewable_instead_of_guessing() -> None:
    draft = parse_clinical_text("Freier Text ohne bekannte medizinische Abschnittsüberschriften")

    assert draft.candidates == []
    assert draft.warnings


def test_tabular_laboratory_report_creates_structured_observations() -> None:
    text = """
Laborbefund vom 08.08.2026
Kleines Blutbild
Parameter\tErgebnis\tEinheit\tReferenzbereich
Leukozyten\t6,4\tG/l\t(3,7 - 9,9)
Hämoglobin\t11,2*\tg/dl\t(12,0 - 16,0)
Immunologie
Antikörper-Screening\tnegativ\t\tnegativ
Nierenfunktion\nGeschätzte GFR\t> 60\tml/min\t(> 60)
"""

    draft = parse_clinical_text(text)
    rows = [item for item in draft.candidates if item.target == "lab_result"]

    assert len(rows) == 4
    assert rows[0].normalized["analyte_name"] == "Leukozyten"
    assert rows[0].normalized["numeric_result"] == 6.4
    assert rows[0].normalized["reference_low"] == 3.7
    assert rows[0].normalized["reference_high"] == 9.9
    assert rows[0].normalized["abnormal_flag"] == "normal"
    assert rows[0].normalized["measured_on"] == "2026-08-08"
    assert rows[1].normalized["abnormal_flag"] == "abnormal"
    assert rows[2].normalized["result_text"] == "negativ"
    assert rows[3].normalized["comparator"] == ">"
    assert rows[3].source.page == 1


def test_laboratory_observation_without_date_requires_review() -> None:
    draft = parse_clinical_text("Parameter\tErgebnis\tEinheit\nCRP\t2,1\tmg/l")

    row = next(item for item in draft.candidates if item.target == "lab_result")
    assert row.selected is False
    assert row.normalized["measured_on"] is None
    assert "laboratory_date_requires_confirmation" in row.normalized["review_reasons"]


def test_longitudinal_laboratory_columns_preserve_every_date_and_value() -> None:
    text = """
Laborwerte
Parameter        Einheit    Referenz       01.08.2021   03.08.2021
Hämoglobin       g/dl       12-15          15,1         14,5
CRP              ng/ml      <0,5           9,9          1,5
"""

    rows = [item for item in parse_clinical_text(text).candidates if item.target == "lab_result"]

    assert [
        (
            row.normalized["analyte_name"],
            row.normalized["measured_on"],
            row.normalized["result_text"],
            row.normalized["unit"],
            row.normalized["reference_text"],
            row.normalized["abnormal_flag"],
        )
        for row in rows
    ] == [
        ("Hämoglobin", "2021-08-01", "15,1", "g/dl", "12-15", "high"),
        ("Hämoglobin", "2021-08-03", "14,5", "g/dl", "12-15", "normal"),
        ("CRP", "2021-08-01", "9,9", "ng/ml", "<0,5", "high"),
        ("CRP", "2021-08-03", "1,5", "ng/ml", "<0,5", "high"),
    ]


def test_narrative_laboratory_decimal_and_encounter_dates_are_not_truncated() -> None:
    text = """
Herr Beispiel, der sich vom 31.07. bis 02.08.2016 in unserer stationären Behandlung befand.
Diagnosen
Akute Appendizitis
Laborwerte bei Aufnahme: Hämoglobin (Hb): 152 g/L, Hämatokrit:
0.44, Thrombozyten: 350/nL, Leukozyten: 14.000/μL; Gerinnung: INR: 1.00, PTT: 28 s, TPZ:
99%
"""

    rows = [item for item in parse_clinical_text(text).candidates if item.target == "lab_result"]

    assert len(rows) == 7
    assert {row.normalized["measured_on"] for row in rows} == {"2016-07-31"}
    hematocrit = next(row for row in rows if row.normalized["analyte_name"] == "Hämatokrit")
    assert hematocrit.normalized["result_text"] == "0.44"
    assert hematocrit.normalized["numeric_result"] == 0.44
    leukocytes = next(row for row in rows if row.normalized["analyte_name"] == "Leukozyten")
    assert leukocytes.normalized["numeric_result"] == 14000.0


def test_medication_table_wraps_disclaimer_and_daily_frequency_fail_closed() -> None:
    text = """
Empfohlene Medikation
Wirkstoff                               Handelsname               Einnahme              Bemerkung
Lactulose 10 g                          Bifiteral®                1-1-1                 Titration zu 2–3 wei-
                                                                                        chen Stuhlgängen/Tag
Pantoprazol 40 mg                       Pantozol®                 1x täglich            Ulkusprophylaxe
(Die aufgeführten Präparate können durch wirk-
stoffgleiche Präparate ersetzt werden.)
Laborwerte
Parameter        Einheit    Referenz       05.11.2025
CRP              mg/l       < 5            8,2
"""

    draft = parse_clinical_text(text)
    medications = [item for item in draft.candidates if item.target == "medication"]

    assert len(medications) == 2
    lactulose, pantoprazole = medications
    assert lactulose.normalized["wirkstoff"] == "Lactulose"
    assert lactulose.normalized["handelsname"] == "Bifiteral®"
    assert lactulose.normalized["hinweis"] == "Titration zu 2–3 weichen Stuhlgängen/Tag"
    assert pantoprazole.normalized["hinweis"] == "1x täglich Ulkusprophylaxe"
    assert "dose_time_requires_confirmation" in pantoprazole.normalized["review_reasons"]
    assert all(item.selected is False for item in medications)
    assert not any("stoffgleiche" in item.value for item in draft.candidates)


def test_wrapped_example_trade_name_and_compound_strength_are_repaired() -> None:
    text = """
Medikation bei Entlassung
Novaminsulfon 500 mg p.o. (z.B. Novaminsulfon-    1-1-1 bis inkl. 07.08.2016
ratiopharm®)
Amoxicillin/Clavulansäure 825/125 mg (z.B. Amoxiclav®) 1-0-1
"""

    medications = [
        item for item in parse_clinical_text(text).candidates if item.target == "medication"
    ]

    assert len(medications) == 2
    assert medications[0].normalized["wirkstoff"] == "Novaminsulfon"
    assert medications[0].normalized["handelsname"] == "Novaminsulfon-ratiopharm®"
    assert medications[0].normalized["einnahmeform"] == "oral"
    assert medications[0].normalized["einnahme_bis"] == "2016-08-07"
    assert medications[1].normalized["wirkstoff"] == "Amoxicillin/Clavulansäure"
    assert medications[1].normalized["staerke"] == "825/125 mg"


def test_stationary_letter_nested_bullets_keep_diagnosis_semantics_separate() -> None:
    text = """
Der Patient befand sich vom 11. bis 13.11.2016 in unserer stationären Behandlung.
Diagnosen
• Hauptdiagnose: Symptomatische Cholezystolithiasis
• Nebendiagnosen
  o   Z.n. Nabelherniotomie 2012
  o   Adipositas
• Therapie: Laparoskopische Cholezystektomie
Anamnese
Beschwerdebild bei Aufnahme.
"""

    draft = parse_clinical_text(text)

    assert draft.document_type == "discharge_summary"
    assert [item.value for item in draft.candidates if item.target == "diagnosis"] == [
        "Symptomatische Cholezystolithiasis",
        "Adipositas",
    ]
    assert any(
        item.target == "anamnesis" and item.value == "Z.n. Nabelherniotomie 2012"
        for item in draft.candidates
    )
    assert any(
        item.target == "examination" and item.value == "Laparoskopische Cholezystektomie"
        for item in draft.candidates
    )


def test_narrative_sections_remove_only_safe_pdf_line_hyphenation() -> None:
    draft = parse_clinical_text(
        "Befund\nKeine signifikanten Rückbil-\ndungsstörungen. H.-p.-\nEradikation geplant."
    )

    finding = next(item for item in draft.candidates if item.target == "examination")
    assert finding.value == (
        "Keine signifikanten Rückbildungsstörungen. H.-p.-\nEradikation geplant."
    )


def test_radiology_native_pdf_spacing_artifacts_are_repaired_conservatively() -> None:
    draft = parse_clinical_text(
        """
Klinische Angaben:
Verlaufskontrolle zu 06 /20 22 bei Colon - Ca (ED 2009)
Befund:
MRCP m it regelrechter D arstellung des Ductus choledochus.
Beurteilung:
Unauffällige parenchymatö se Oberbauchorgane. Keine lympho gene Filialisierung.
"""
    )

    assert draft.document_type == "radiology_report"
    values = [item.value for item in draft.candidates]
    assert values == [
        "Verlaufskontrolle zu 06/2022 bei Colon-Ca (ED 2009)",
        "MRCP mit regelrechter Darstellung des Ductus choledochus.",
        "Unauffällige parenchymatöse Oberbauchorgane. Keine lymphogene Filialisierung.",
    ]


def test_administrative_cost_estimate_never_proposes_clinical_facts() -> None:
    draft = parse_clinical_text(
        """
Unverbindliche voraussichtliche Kostenschätzung für medizinische Untersuchungen
MEDIZINISCHE LEISTUNGEN
Gastroenterologische Untersuchung und Beratung mit Gastro- und Koloskopie
8.800,00 - 12.000,00 EUR
"""
    )

    assert draft.document_type == "administrative_cost_estimate"
    assert draft.candidates == []
    assert draft.warnings == [
        "Administrative cost estimate recognized; no clinical facts were proposed."
    ]


def test_oncology_report_folds_wrapped_diagnoses_and_keeps_inline_chronology_labels() -> None:
    text = """
Onkologische Diagnosen:
03.08.21 mehrere Haut bzw. Lymphknotenmetastasen axillär und cervikal
links axillär und links cervical beschrieben
histologisch gesichert
28.04.21 ED Doppel Karzinom des Kolons:
Kolon ascendens: pT3 / pN1a G2 R0
UICC Stadium: III B
Rektumkarzinom: der unteren und mittleren Etage, bioptisch gesichert
cT3, cN+, G2
Immunhistochemisch am Kolonkarzinom Präparat:
Mikrosatelliteninstabilität, KRAS Mutation, BRAF Wildtyp

Nichtonkologische Diagnosen:
27.08.21 V.a. HNPCC (Lynch Syndrom)
24.07.21 Posterior Infarkt links mit Quadrantenanopsie
NIHSS bei Aufnahme: 1 Punkt, Genese kardioembolisch bei Vorhofflimmern
bislang ohne orale Antikoagulation, Start mit Apixaban
Arterielle Hypertonie
Z.n. Myokardinfarkt
Defibrillator

Aktuell:
Zwischenuntersuchung mit FDG PET CT

Chronologie:
16.12.2021 Coloskopie und Proktoskopie
Diagnosen: Exulzeriertes Rektumkarzinom, stabiler Befund
Histologie: keine Dysplasie
17.12.2021 CT Schädel: kein Tumornachweis

Anamnese:
19.04.22 Der Allgemeinzustand ist gut und hat sich deutlich gebessert.

Häusliche Medikation:
21.04.22 Fenistil Tropfen, Decortin 5-10 mg bei Bedarf
17.07.21 neu APIXABAN
08.06.2 MED Medikamente: Cardiomagnil (ASS) 0.0-0.0-1.0-0.0 75mg/Tabl., Liprimar
1 (Atorvastatin) 0.0-0.0-1.0-0.0 10 mg/Tabl., Noliprel 1,25mg/5mg 1.0-0.0-0.0-0.0
Tabl., Concor (Bisoprolol) 5 mg 1.0-0.0-0.0-0.0

Körpermaße:
19.04.22 Größe: 173 cm Gewicht: 76,5 kg

Labor vom .2022
CRP=2.0 mg/l; GFR=51 ml/min

Zusammenfassende Beurteilun :
Das Doppelkarzinom des Kolons wurde histologisch gesichert.
Für die weitere Behandlung bedeutet die Mikrosatelliteninstabilität eine hohe Wirksamkeit.
Die Europäische Kommission hat Pembrolizumab zugelassen.
Schwere Nebenwirkungen können sein:
Lungenprobleme (Pneumonitis), Colitis und Hepatitis.
Wichtig ist eine rasche medizinische Behandlung. Bitte stellen Sie sich umgehend vor.
Aktuell haben wir nach 4 Monaten Erhaltungstherapie ein Zwischenstaging durchgeführt.
Prinzipiell ist eine Rektumresektion eine mögliche Therapie Option.
Bis zur Wiedervorstellung empfehlen wir Pembrolizumab fortzuführen.
Die Wiedervorstellung in 6 Wochen ist lebensnotwendig.

Mit freundlichen kollegialen Grüßen,
Dr. Beispiel
"""

    draft = parse_clinical_text(text)

    diagnoses = [item for item in draft.candidates if item.target == "diagnosis"]
    assert len(diagnoses) == 5, [item.value for item in diagnoses]
    assert any("mehrere Haut" in item.value and "histologisch gesichert" in item.value for item in diagnoses)
    assert any("Doppel Karzinom" in item.value and "UICC Stadium" in item.value for item in diagnoses)
    assert any("Posterior Infarkt" in item.value and item.selected for item in diagnoses)
    suspected = next(item for item in diagnoses if "HNPCC" in item.value)
    assert suspected.selected is False
    assert not any(item.value.startswith("Diagnosen:") for item in diagnoses)

    history = [item for item in draft.candidates if item.target == "anamnesis"]
    assert any(item.normalized.get("semantic_role") == "personal_history" and "Myokardinfarkt" in item.value for item in history)
    assert any(item.normalized.get("semantic_role") == "personal_history" and "Defibrillator" in item.value for item in history)

    chronology = [
        item
        for item in draft.candidates
        if item.normalized.get("semantic_role") == "chronology_event"
    ]
    assert len(chronology) == 2
    assert "Diagnosen: Exulzeriertes Rektumkarzinom" in chronology[0].value

    medications = [item.value for item in draft.candidates if item.target == "medication"]
    assert medications == [
        "Fenistil Tropfen",
        "Decortin 5-10 mg bei Bedarf",
        "APIXABAN",
        "Cardiomagnil (ASS) 0.0-0.0-1.0-0.0 75mg/Tabl.",
        "Liprimar (Atorvastatin) 0.0-0.0-1.0-0.0 10 mg/Tabl.",
        "Noliprel 1,25mg/5mg 1.0-0.0-0.0-0.0 Tabl.",
        "Concor (Bisoprolol) 5 mg 1.0-0.0-0.0-0.0",
    ]

    examinations = [item for item in draft.candidates if item.target == "examination"]
    assert any(item.normalized.get("semantic_role") == "laboratory" for item in examinations)
    assert any(item.normalized.get("semantic_role") == "assessment" for item in examinations)
    assert any(item.normalized.get("semantic_role") == "current_finding" for item in examinations)

    recommendations = [item for item in draft.candidates if item.target == "recommendation"]
    assert any(item.normalized.get("semantic_role") == "patient_safety_instruction" for item in recommendations)
    assert any(item.normalized.get("semantic_role") == "treatment_plan" for item in recommendations)
    assert not any("Lungenprobleme" in item.value for item in draft.candidates)
    assert "Lungenprobleme" in draft.raw_text
    assert any("adverse-effect catalogue" in warning for warning in draft.warnings)
