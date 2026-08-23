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


def test_physical_examination_and_further_findings_do_not_leak_into_anamnesis() -> None:
    text = """
Anamnese
Seit gestern Husten und Fieber.
Sozialanamnese
Lebt allein, kein Pflegegrad.
Körperlicher Untersuchungsbefund bei Aufnahme
Blutdruck 150/90 mmHg. Pulmo rechtsseitig feuchte Rasselgeräusche.
Weitere Diagnostik/Befunde
Röntgen-Thorax: Infiltrat im rechten Oberlappen.
Beurteilung und Verlauf
Antibiotische Therapie wurde begonnen.
"""

    draft = parse_clinical_text(text)
    anamnesis = [item for item in draft.candidates if item.target == "anamnesis"]
    examinations = [item for item in draft.candidates if item.target == "examination"]

    assert len(anamnesis) == 2
    assert all("Blutdruck" not in item.value for item in anamnesis)
    assert all("Röntgen-Thorax" not in item.value for item in anamnesis)
    assert [item.source.section for item in examinations] == [
        "Körperlicher Untersuchungsbefund bei Aufnahme",
        "Weitere Diagnostik/Befunde",
        "Beurteilung und Verlauf",
    ]


def test_repeated_letterhead_does_not_leak_into_cross_page_examination() -> None:
    text = """
Carotisduplex
Keine relevante Stenose.
\f
PRIVATPRAXIS
FACHARZT FÜR INNERE MEDIZIN UND KARDIOLOGIE
DR. MED. ULRICH HÖLZENBEIN
SPORTMEDIZIN - NOTFALLMEDIZIN - LABORDIAGNOSTIK
Echokardiographie
Gute linksventrikuläre Pumpfunktion.
"""

    rows = [
        item for item in parse_clinical_text(text).candidates if item.target == "examination"
    ]

    assert [row.source.section for row in rows] == ["Carotisduplex", "Echokardiographie"]
    assert rows[0].value == "Keine relevante Stenose."


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


def test_dated_normwert_laboratory_form_creates_one_candidate_per_row() -> None:
    text = """
Testbezeichnung
13.02.23
Normwert
Blutbild
PTT (part. Thromboplastinzeit) 24.4 - 32.4 (sec)\t24.5
Erythrozyten\t4.54 - 5.77 (Mio./ul)\t5.02
Leukozyten\t3.9 - 9.8 (Tsd./ul)\t5.3
Differential Blutbild absolut
neutrophile Granulozyten\t1.8 - 6.2 (Tsd./ul)\t3.370
Ausdru:kvom 15.02.2023
\f
Testbezeichnung
13.0223
Normwert
Eiweiß-Elektrophorese
Cholesterin, Gesamt-\t<= 200 (mg/dl)\t209 (+)
HDL-Cholesterin\t>= 40 (mg/dl)\t39 (-)
Ausdruck vom 15.02.2023
"""

    draft = parse_clinical_text(text)
    rows = [item for item in draft.candidates if item.target == "lab_result"]

    assert draft.document_type == "laboratory_report"
    assert len(rows) == 6
    assert {row.normalized["measured_on"] for row in rows} == {"2023-02-13"}
    erythrocytes = next(row for row in rows if row.normalized["analyte_name"] == "Erythrozyten")
    assert erythrocytes.normalized["numeric_result"] == 5.02
    assert erythrocytes.normalized["reference_low"] == 4.54
    assert erythrocytes.normalized["reference_high"] == 5.77
    assert erythrocytes.normalized["unit"] == "Mio./ul"
    assert erythrocytes.normalized["panel"] == "Blutbild"
    neutrophils = next(
        row for row in rows if row.normalized["analyte_name"] == "neutrophile Granulozyten"
    )
    assert neutrophils.normalized["panel"] == "Differential Blutbild absolut"
    cholesterol = next(
        row for row in rows if row.normalized["analyte_name"] == "Cholesterin, Gesamt"
    )
    assert cholesterol.normalized["abnormal_flag"] == "high"
    hdl = next(row for row in rows if row.normalized["analyte_name"] == "HDL-Cholesterin")
    assert hdl.normalized["abnormal_flag"] == "low"
    ptt = next(row for row in rows if row.normalized["analyte_name"].startswith("PTT"))
    assert ptt.normalized["result_text"] == "24.5"
    assert ptt.normalized["reference_text"] == "24.4 - 32.4"
    assert ptt.normalized["unit"] == "sec"


def test_dated_normwert_scan_recovers_headerless_first_page_and_split_rows() -> None:
    text = """
Blutbild
Erythrozyten\t4.54 - 5.77 (Mio./μl)\t5.02
Hämoglobin\t13.5 - 17.5 (g/dl)\t15.1
Hämatokrit\t40 - 51 (%)\t43
MCH (HbE)\t27.6 - 32.8 (pg/Ery)\t30.1
MCHC\t32.8 - 36.6 (g/dl)\t35.0
MCV\t80 - 96 (fl)\t86.1
Leukozyten\t3.9 - 9.8 (Tsd./μl)\t5.3
Thrombozyten\t146 - 328 (Tsd./μl)\t214
Differential Blutbild absolut
neutrophile Granulozyten\t1.8 - 6.2 (Tsd./μl)\t3.370
eosinophile Granulozyten\t0.03 - 0.44 (Tsd./μl)\t0.130
basophile Granulozyten\t0.01 - 0.08 (Tsd./μl)\t0.020
Lymphozyten\t1.1 - 3.2 (Tsd./μl)\t1.410
Monozyten\t0.26 - 0.87 (Tsd./μl)\t0.330
Differenzial Blutbild relativ
neutrophile Granulozyten\t40 - 75 (%)\t64
Monozyten\t4 - 12 (%)\t6
Gerinnung
Prothrombinzeit (Quick)\t>= 70 (%)\t106
INR (internat. normal. ratio)\t<= 1.2 (keine Einheit)\t0.97
PTT (part. Thromboplastinzeit)\t24.4 - 32.4 (sec)\t24.5
Diabetologie
Glucose venös (Plasma)\t65 - 100 (mg/dl)\t90
Hämatologie
Natrium\t135 - 145 (mmol/l)\t140
Kalium\t3.5 - 5 (mmol/l)\t4.3
Calcium\t2.2 - 2.65 (mmol/l)\t2.41
Magnesium\t0.7 - 1.1 (mmol/l)\t0.87
Eisen\t70 - 180 (μg/dl)\t112
Phosphat, anorganisch\t2.5 - 4.5 (mg/dl)\t3.32
N\tKreatinin\t<= 1.2 (mg/dl)\t0.9
GFR (CKD-EPI-Formel)\t>= 60 (ml/min/1.73m2)\t116
Harnstoff\t17 - 43 (mg/dl)\t36
Harnsäure\t<= 7.2 (mg/dl)\t6.3
Bilirubin\t<= 1.2 (mg/dl)\t0.7
Eiweiß, Gesamt-\t64 - 83 (g/l)\t71
Eiweiß-Elektrophorese
alpha-1-Globulin\t2.9 - 4.9 (%)\t3.2
alpha-2-Globulin\t7.1 - 11.8 (%)\t8.4

Testbezeichnung\tNormwert\t13.02.23
Eiweiß-Elektrophorese
beta-1-Globulin\t4.7 - 7.2 (%)\t5.2
beta-2-Globulin\t3.2 - 6.5 (%)\t3.7
gamma-Globulin\t11.1 - 18.8 (%)\t13.5
Cholesterin, Gesamt-\t<= 200 (mg/dl)\t209 (+)
HDL-Cholesterin\t>= 40 (mg/dl)\t39 (-)
LDL-Cholesterin\tZielwerte (nach ESC-Leitlini\t136
Triglyceride\t<= 150 (mg/dl)\t297 (+)
CK (Creatinkinase)\t<= 190 (U/l)\t120
GOT (ASAT)\t<= 50 (U/l)\t19
GPT (ALAT)\t<= 50 (U/l)\t37
gamma-GT\t<= 60 (U/l)\t89 (+)
/\tAP (Alkalische Phosphatase)\t40 - 130 (U/l)\t122
CHE (Cholinesterase)\t4620 - 11500 (U/l)\t6488
LDH (Lactat-Dehydrogenase)\t<= 250 (U/l)\t163
Immunglobulin G\t7 - 16 (g/l)\t10.13
Immunglobulin A\t0.7 - 4 (g/l)\t1.19
Immunglobulin M\t0.4 - 2.3 (g/l)\t0.49
Schilddrüse
TSH\t0.25 - 5 (uUl/ml)\t1.08
√\tFT3\t4 - 8.3 (pmol/l)\t3.98 (-)
FT4\t10.6 - 19.4 (pmol/l)\t18.88
Sonstiges
170.32
Ferritin\t68 - 434 (ng/ml)
HbA1c (NGSP)\t<= 5.7 (%)\t5.2
Erythrozytenverteilungsbreite\t<= 14.8 (%)\t11.9
Vitamine
25-OH-Vitamin D\t30 - 100 (ng/ml)\t36.8
"""

    rows = [item for item in parse_clinical_text(text).candidates if item.target == "lab_result"]

    assert len(rows) == 57
    assert sum(row.source.page == 1 for row in rows) == 33
    assert sum(row.source.page == 2 for row in rows) == 24
    assert {row.normalized["measured_on"] for row in rows} == {"2023-02-13"}
    assert next(
        row for row in rows if row.normalized["analyte_name"] == "Kreatinin"
    ).normalized["numeric_result"] == 0.9
    assert next(
        row for row in rows if row.normalized["analyte_name"] == "AP (Alkalische Phosphatase)"
    ).normalized["unit"] == "U/l"
    assert next(
        row for row in rows if row.normalized["analyte_name"] == "FT3"
    ).normalized["abnormal_flag"] == "low"
    ferritin = next(row for row in rows if row.normalized["analyte_name"] == "Ferritin")
    assert ferritin.normalized["numeric_result"] == 170.32
    assert ferritin.normalized["reference_low"] == 68
    assert ferritin.normalized["reference_high"] == 434


def test_laboratory_report_attributes_explicit_organisation_to_every_observation() -> None:
    text = """
SYNLAB Medizinisches Versorgungszentrum Berlin GmbH
Laborbefund vom 08.08.2026
Parameter\tErgebnis\tEinheit\tReferenzbereich
Leukozyten\t6,4\tG/l\t(3,7 - 9,9)
CRP\t2,1\tmg/l\t(< 5,0)
"""

    rows = [item for item in parse_clinical_text(text).candidates if item.target == "lab_result"]

    assert len(rows) == 2
    assert {row.normalized["laboratory_name"] for row in rows} == {
        "SYNLAB Medizinisches Versorgungszentrum Berlin GmbH"
    }


def test_generic_laboratory_heading_is_not_used_as_organisation() -> None:
    text = """
Laborbefund vom 08.08.2026
Parameter\tErgebnis\tEinheit\tReferenzbereich
CRP\t2,1\tmg/l\t(< 5,0)
"""

    row = next(item for item in parse_clinical_text(text).candidates if item.target == "lab_result")

    assert row.normalized["laboratory_name"] is None


def test_german_ocr_lab_header_and_sidebar_noise_create_observations() -> None:
    text = """
München, den 28.05.2026
Ihre Laborbefund
nachfolgend erhalten Sie den Bericht zur Untersuchung vom 26.05.2026
Bezeichnung\tWert\tEinheit\tNormbereich
muenchen-klinik.de
Blutbild\tAkademisches
Leuko\t6,4\t/nl\t( 3,7 - 9,9 )\tLehrkrankenhaus der
Ludwig-Maximilians-Universität
Ery\t5,8\t/pl\t( 4,4 - 5,9 )
Hämoglobin\t17,2\tg/dl\t( 13,5 - 17,8 )\tQualitätsmanagementsystem zertifiziert
Enzyme
GGT\t15\tU/I\t( 12 - 64 )
Immunsystem
Mas-IgG-AK i.S.\t85,9\tAU/ml
Mumps-IgG i.S.\t16,6\tAU/ml
München Klinik gGmbH\tGeschäftsführung:\tHandelsregister
\f
VZV IgG-AK\t2.470\tтіЕ/ті\t(100 - 10000)\tT 089/9270-2447
Anti-HCV\tnegativ
HIV-AG/AK CMIA\tnegativ\tbetriebsarzt@muenchen-klinik.de
Impftiter\tDr. Rosa Lancier
Anti-HBs-Ak\t1.391,4\tmIE/ml\t(100 - 10000)\tFÄ für Arbeitsmedizin
Sonstiges
CRP\t<0.5\tmg/l\t(< 5,0)\tDr. Michael Berchtenbreiter
Stoffwechsel\ta
Glucose\t99\tmg/dl\t(70 - 100)\tklausmichael.berchtenbreiter
Cholesterin\t209\tmg/dl\t(< 200)\tx @muenchen-klinik.de
Wasser- / Elektrolythaushalt
Creatinin\t1.6\tmg/dl\t(0,7-1,2)\tx
GFR CKD-EPI\t59\tml/min\t(> 60)\t*
"""

    draft = parse_clinical_text(text)
    rows = [item for item in draft.candidates if item.target == "lab_result"]

    assert draft.document_type == "laboratory_report"
    assert len(rows) == 15
    assert {row.normalized["measured_on"] for row in rows} == {"2026-05-26"}
    assert all("muenchen-klinik" not in (row.normalized["unit"] or "") for row in rows)
    leuko = next(row for row in rows if row.normalized["analyte_name"] == "Leuko")
    assert leuko.normalized["unit"] == "/nl"
    assert leuko.normalized["reference_text"] == "( 3,7 - 9,9 )"
    assert leuko.normalized["abnormal_flag"] == "normal"
    hcv = next(row for row in rows if row.normalized["analyte_name"] == "Anti-HCV")
    assert hcv.normalized["result_text"] == "negativ"
    assert hcv.normalized["unit"] is None
    assert hcv.selected is True
    vzv = next(row for row in rows if row.normalized["analyte_name"] == "VZV IgG-AK")
    assert vzv.normalized["unit"] is None
    assert vzv.selected is False
    assert "laboratory_unit_requires_confirmation" in vzv.normalized["review_reasons"]
    cholesterol = next(
        row for row in rows if row.normalized["analyte_name"] == "Cholesterin"
    )
    assert cholesterol.normalized["panel"] == "Stoffwechsel"
    assert cholesterol.normalized["abnormal_flag"] == "high"
    gfr = next(row for row in rows if row.normalized["analyte_name"] == "GFR CKD-EPI")
    assert gfr.normalized["panel"] == "Wasser- / Elektrolythaushalt"
    assert gfr.normalized["unit"] == "ml/min"
    assert gfr.normalized["abnormal_flag"] == "low"
    assert gfr.source.page == 2


def test_unpaired_ocr_surrogate_is_sanitized_without_losing_lab_rows() -> None:
    draft = parse_clinical_text(
        "Laborbefund vom 26.05.2026\n"
        "Bezeichnung\tWert\tEinheit\tNormbereich\n"
        "CRP\t2,1\tmg/l\t(< 5,0)\udc96"
    )

    row = next(item for item in draft.candidates if item.target == "lab_result")
    assert row.normalized["analyte_name"] == "CRP"
    assert row.normalized["numeric_result"] == 2.1
    assert "\udc96" not in draft.raw_text
    assert "\ufffd" in draft.raw_text


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


def test_longitudinal_laboratory_table_continuation_realigns_shifted_columns() -> None:
    text = """
Laborwerte
Messgröße                              Referenzbereich           01.08.2021         03.08.2021
CRP                                    0,0 - 0,5 mg/dl           0,3                0,2
\f
Troponin T                      0,0 - 0,1 ng/ml       0,02
Calcium                         2,2 - 2,6 mmol/l      2,21
Natrium                         135 - 145 mmol/l      140
Kalium                          3,5 - 5,0 mmol/l      3,9            4,1
Magnesium                       1,7 - 2,4 mmol/l      1,8

Wichtiger Hinweis
Dies ist kein echter Arztbrief.
"""

    rows = [item for item in parse_clinical_text(text).candidates if item.target == "lab_result"]

    assert [
        (
            row.normalized["analyte_name"],
            row.normalized["measured_on"],
            row.normalized["result_text"],
            row.normalized["unit"],
            row.normalized["reference_text"],
        )
        for row in rows
    ] == [
        ("CRP", "2021-08-01", "0,3", "mg/dl", "0,0 - 0,5"),
        ("CRP", "2021-08-03", "0,2", "mg/dl", "0,0 - 0,5"),
        ("Troponin T", "2021-08-01", "0,02", "ng/ml", "0,0 - 0,1"),
        ("Calcium", "2021-08-01", "2,21", "mmol/l", "2,2 - 2,6"),
        ("Natrium", "2021-08-01", "140", "mmol/l", "135 - 145"),
        ("Kalium", "2021-08-01", "3,9", "mmol/l", "3,5 - 5,0"),
        ("Kalium", "2021-08-03", "4,1", "mmol/l", "3,5 - 5,0"),
        ("Magnesium", "2021-08-01", "1,8", "mmol/l", "1,7 - 2,4"),
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


def test_vital_candidate_keeps_kardio_document_date_as_review_only_provenance() -> None:
    text = """
Musterstadt, 04.05.2015
Körperliche Untersuchung
RR: 170/91 mmHg, Puls: 72, Sauerstoffsättigung(%): 96
"""

    draft = parse_clinical_text(text)
    vital = next(item for item in draft.candidates if item.target == "vital")

    assert vital.selected is False
    assert vital.value == "RR: 170/91 mmHg, Puls: 72, Sauerstoffsättigung(%): 96"
    assert vital.normalized["measured_at"] == "2015-05-04"
    assert vital.normalized["bp_systolic"] == 170
    assert vital.normalized["bp_diastolic"] == 91
    assert vital.normalized["heart_rate"] == 72
    assert vital.normalized["oxygen_saturation"] == 96
    assert vital.normalized["units"] == {
        "bp_systolic": "mmHg",
        "bp_diastolic": "mmHg",
        "heart_rate": "bpm",
        "oxygen_saturation": "%",
    }
    assert vital.normalized["review_reasons"] == [
        "inferred_measured_at_from_document_date"
    ]


def test_vital_candidate_rejects_ocr_joined_letter_date_as_measurement_date() -> None:
    text = """
Körperliche Untersuchung
Musterstadt, 04.05.2015 RR: 120/80 mmHg
"""

    vital = next(
        item for item in parse_clinical_text(text).candidates if item.target == "vital"
    )

    assert vital.selected is False
    assert "measured_at" not in vital.normalized
    assert vital.normalized["review_reasons"] == ["missing_measured_at"]


def test_vital_candidate_rejects_authored_date_phrases_joined_to_measurements() -> None:
    for row in (
        "Arztbrief vom 04.05.2015 RR: 120/80 mmHg",
        "Dokument erstellt am 04.05.2015 RR: 120/80 mmHg",
        "04.05.2015 Musterstadt RR: 120/80 mmHg",
        "04.05.2015 Arztbrief RR: 120/80 mmHg",
    ):
        vital = next(
            item
            for item in parse_clinical_text(
                f"Körperliche Untersuchung\n{row}"
            ).candidates
            if item.target == "vital"
        )

        assert vital.selected is False
        assert "measured_at" not in vital.normalized
        assert vital.normalized["review_reasons"] == ["missing_measured_at"]


def test_vital_candidate_accepts_explicit_measurement_date_binding() -> None:
    vital = next(
        item
        for item in parse_clinical_text(
            "Körperliche Untersuchung\nMessdatum: 04.05.2015 RR: 120/80 mmHg"
        ).candidates
        if item.target == "vital"
    )

    assert vital.selected is True
    assert vital.normalized["measured_at"] == "2015-05-04"
    assert vital.normalized["review_reasons"] == []


def test_vital_candidate_uses_admission_date_and_normalizes_decimal_commas() -> None:
    text = """
Stationäre Behandlung vom 01.03.2017 bis 05.03.2017

Körperlicher Untersuchungsbefund bei Aufnahme
Blutdruck: 150/90 mmHg, Temperatur: 38,9 °C, Puls 95/min, spO2:
92%. Gewicht: 82 kg, Größe: 1,68 m, BMI: 29,1 kg/m2.
"""

    vitals = [item for item in parse_clinical_text(text).candidates if item.target == "vital"]

    assert len(vitals) == 1
    vital = vitals[0]
    assert vital.selected is True
    assert vital.source.page == 2
    assert vital.normalized["measured_at"] == "2017-03-01"
    assert vital.normalized["temperature_c"] == 38.9
    assert vital.normalized["heart_rate"] == 95
    assert vital.normalized["oxygen_saturation"] == 92
    assert vital.normalized["weight_kg"] == 82
    assert vital.normalized["height_cm"] == 168
    assert vital.normalized["bmi"] == 29.1


def test_vital_candidate_accepts_dot_decimals_and_exact_unit_conversions() -> None:
    text = """
Körpermaße
19.04.2022 Gewicht: 168.7 lb, Größe: 68 in, BMI: 25.6 kg/m2
"""

    vital = next(
        item for item in parse_clinical_text(text).candidates if item.target == "vital"
    )

    assert vital.selected is True
    assert vital.normalized["measured_at"] == "2022-04-19"
    assert vital.normalized["weight_kg"] == 76.52
    assert vital.normalized["height_cm"] == 172.72
    assert vital.normalized["bmi"] == 25.6
    assert vital.normalized["raw_measurements"]["weight_kg"] == [
        {"value": "168.7", "unit": "lb"}
    ]


def test_vital_candidate_fails_closed_without_date_or_for_conflicts() -> None:
    text = """
Körperliche Untersuchung
RR: 170/91 mmHg, Puls: 72, Sauerstoffsättigung(%): 96
Gewicht: 76,5 kg, Gewicht: 180 lb, Größe: 173 cm, BMI: 20,0 kg/m2
Temperatur: 38,9
"""

    vitals = [item for item in parse_clinical_text(text).candidates if item.target == "vital"]

    assert len(vitals) == 3
    assert all(item.selected is False for item in vitals)
    assert all("missing_measured_at" in item.normalized["review_reasons"] for item in vitals)
    body_measurement = next(item for item in vitals if "180 lb" in item.value)
    assert "conflicting_measurements:weight_kg" in body_measurement.normalized["review_reasons"]
    assert "bmi_conflict" in body_measurement.normalized["review_reasons"]
    temperature = next(item for item in vitals if item.value.startswith("Temperatur"))
    assert "ambiguous_unit:temperature_c" in temperature.normalized["review_reasons"]


def test_vital_candidate_rejects_implausible_values_and_invalid_bp_order() -> None:
    text = """
Körperliche Untersuchung vom 01.01.2022
RR: 60/90 mmHg, Puls: 400/min, SpO2: 108%, AF: 2/min
"""

    vital = next(
        item for item in parse_clinical_text(text).candidates if item.target == "vital"
    )

    assert vital.selected is False
    assert vital.normalized["review_reasons"] == [
        "implausible_measurement:heart_rate",
        "implausible_measurement:oxygen_saturation",
        "implausible_measurement:respiratory_rate",
        "invalid_blood_pressure_order",
    ]


def test_vital_candidate_preserves_unsupported_units_and_fails_closed() -> None:
    text = """
Körperliche Untersuchung vom 01.01.2022
Gewicht: 180 oz
"""

    vital = next(
        item for item in parse_clinical_text(text).candidates if item.target == "vital"
    )

    assert vital.selected is False
    assert "weight_kg" not in vital.normalized
    assert vital.normalized["raw_measurements"] == {
        "weight_kg": [{"value": "180", "unit": "oz"}]
    }
    assert vital.normalized["review_reasons"] == ["unsupported_unit:weight_kg"]


def test_vital_candidate_combines_composite_imperial_dimensions() -> None:
    text = """
Körpermaße
19.04.2022 Größe: 5 ft 10 in, Gewicht: 12 st 3 lb
"""

    vital = next(
        item for item in parse_clinical_text(text).candidates if item.target == "vital"
    )

    assert vital.selected is True
    assert vital.normalized["height_cm"] == 177.8
    assert vital.normalized["weight_kg"] == 77.56
    assert vital.normalized["raw_measurements"] == {
        "height_cm": [{"value": "5 10", "unit": "ft+in"}],
        "weight_kg": [{"value": "12 3", "unit": "st+lb"}],
    }
    assert vital.normalized["review_reasons"] == []


def test_vital_candidate_fails_closed_for_invalid_composite_components() -> None:
    text = """
Körpermaße
19.04.2022 Größe: 5 ft 14 in, Gewicht: 12 st 15 lb
"""

    vital = next(
        item for item in parse_clinical_text(text).candidates if item.target == "vital"
    )

    assert vital.selected is False
    assert vital.normalized["review_reasons"] == [
        "invalid_composite_unit:height_cm",
        "invalid_composite_unit:weight_kg",
    ]


def test_vital_candidate_fails_closed_for_local_time_without_timezone() -> None:
    text = """
Körperliche Untersuchung
01.01.2022 14:30 Uhr RR: 120/80 mmHg
"""

    vital = next(
        item for item in parse_clinical_text(text).candidates if item.target == "vital"
    )

    assert vital.selected is False
    assert vital.normalized["measured_at"] == "2022-01-01"
    assert vital.normalized["source_measured_time"] == "14:30:00"
    assert vital.normalized["review_reasons"] == ["ambiguous_measured_at_timezone"]


def test_vital_candidate_accepts_offset_aware_explicit_time() -> None:
    text = """
Körperliche Untersuchung
01.01.2022 14:30 Uhr +0200 RR: 120/80 mmHg
"""

    vital = next(
        item for item in parse_clinical_text(text).candidates if item.target == "vital"
    )

    assert vital.selected is True
    assert vital.normalized["measured_at"] == "2022-01-01T14:30:00+02:00"
    assert vital.normalized["source_measured_time"] == "14:30:00+02:00"
    assert vital.normalized["review_reasons"] == []


def test_document_subject_extracts_labeled_header_and_deduplicates_repeats() -> None:
    text = """
Patient: Erika Beispiel, Geburtsdatum: 01.02.1980
Patienten-ID: TEST-1234

Patient: Erika Beispiel, Geburtsdatum: 01.02.1980
Diagnosen
Musterdiagnose
"""

    subject = parse_clinical_text(text).subject

    assert subject is not None
    assert subject.status == "extracted"
    assert subject.conflict is False
    assert subject.first_name == "Erika"
    assert subject.last_name == "Beispiel"
    assert subject.birth_date == "1980-02-01"
    assert subject.patient_identifier == "TEST-1234"
    assert subject.patient_identifier_namespace == "source_document"
    assert subject.field_confidence == {
        "first_name": 0.96,
        "last_name": 0.96,
        "birth_date": 0.99,
        "patient_identifier": 0.99,
    }


def test_document_subject_accepts_header_salutation_but_rejects_narrative_name() -> None:
    header = parse_clinical_text(
        "Frau Erika Beispiel, geb. 01.02.1980\nDiagnosen\nMusterdiagnose"
    ).subject
    narrative = parse_clinical_text(
        "Anamnese\nDie Patientin Erika Beispiel berichtet über Beschwerden."
    ).subject

    assert header is not None
    assert header.first_name == "Erika"
    assert header.last_name == "Beispiel"
    assert header.birth_date == "1980-02-01"
    assert narrative is None


def test_document_subject_is_null_for_redacted_or_missing_identity() -> None:
    redacted = "Herr X. Y. geb. 01.01.198-\nDiagnosen\nMusterdiagnose"
    redacted_with_valid_dob = "Herr A. K. geb. 01.01.1980\nDiagnosen\nMusterdiagnose"
    missing = "Diagnosen\nMusterdiagnose\nAnamnese\nKeine Beschwerden."

    assert parse_clinical_text(redacted).subject is None
    assert parse_clinical_text(redacted_with_valid_dob).subject is None
    assert parse_clinical_text(missing).subject is None


def test_document_subject_accepts_declined_salutation_and_bilingual_dob_label() -> None:
    salutation = parse_clinical_text(
        "Herrn Max Beispiel, geb. 09.06.1984, wohnhaft in Musterstadt"
    ).subject
    bilingual = parse_clinical_text(
        "Geburtsdatum/Дата рождения: 08.08.2005"
    ).subject

    assert salutation is not None
    assert salutation.first_name == "Max"
    assert salutation.last_name == "Beispiel"
    assert salutation.birth_date == "1984-06-09"
    assert bilingual is not None
    assert bilingual.status == "extracted"
    assert bilingual.birth_date == "2005-08-08"


def test_document_subject_fails_closed_on_dob_conflict_or_invalid_date() -> None:
    conflicting = parse_clinical_text(
        "Geburtsdatum: 01.02.1980\nGeburtsdatum: 02.02.1980"
    ).subject
    invalid = parse_clinical_text(
        "Patient: Erika Beispiel, Geburtsdatum: 32.13.2020"
    ).subject

    assert conflicting is not None
    assert conflicting.status == "conflict"
    assert conflicting.conflict is True
    assert conflicting.birth_date is None
    assert conflicting.review_reasons == [
        "conflicting_subject_identity",
        "conflicting_subject_field:birth_date",
    ]
    assert invalid is not None
    assert invalid.status == "conflict"
    assert invalid.birth_date is None
    assert invalid.review_reasons == ["invalid_subject_birth_date"]
