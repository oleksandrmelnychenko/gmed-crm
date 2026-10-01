import re

from app.parser import parse_clinical_text


ONCOLOGY_REPORT = """
Onkologische Diagnosen:
01.02.24 Kolonkarzinom
Verdacht auf Lebermetastase
\f
2
Münchner Onkologie
Ausschluss pulmonale Metastasierung

Nichtonkologische Diagnosen:
Arterielle Hypertonie

Häusliche Medikation:
Metoprolol 47,5 mg 1-0-0

Chronologie:
01.02.2 Erstvorstellung mit Schnittbilddiagnostik
4
03.02.2024 Histologische Sicherung

Zusammenfassende Beurteilung:
Kontrolle in sechs Wochen empfohlen.
Mit freundlichen kollegialen Grüßen
Dr. med. Beispiel
"""


RADIOLOGY_REPORT = """
MRT Thorax
Radiologie

Klinische Angaben:
Kontrolluntersuchung bei bekannter Grunderkrankung.

Befund:
Fokale Verdichtung im rechten Unterlappen.

Beurteilung:
Kein Nachweis einer Lungenembolie.
Verdacht auf fokale Pneumonie.
Kleine Konsolidierung im rechten Unterlappen.
"""


def test_oncology_sections_continue_across_pages_and_parse_specialized_blocks() -> None:
    draft = parse_clinical_text(ONCOLOGY_REPORT)

    assert draft.document_type == "oncology_report"
    diagnoses = [item for item in draft.candidates if item.target == "diagnosis"]
    assert [item.value for item in diagnoses] == [
        "Kolonkarzinom",
        "Verdacht auf Lebermetastase",
        "Arterielle Hypertonie",
    ]
    assert diagnoses[1].normalized["certainty"] == "verdacht"
    assert diagnoses[0].normalized["certainty"] == "bestaetigt"
    assert diagnoses[0].normalized["assertion"] == "confirmed"
    assert diagnoses[0].selected is True
    assert diagnoses[1].normalized["assertion"] == "suspected"
    assert diagnoses[1].selected is False
    assert diagnoses[1].source.page == 1
    assert not any("Ausschluss" in item.value for item in diagnoses)
    rule_out = next(
        item
        for item in draft.candidates
        if item.normalized.get("assertion") == "rule_out"
    )
    assert rule_out.target == "examination"
    assert rule_out.selected is False

    medications = [item for item in draft.candidates if item.target == "medication"]
    assert [item.value for item in medications] == ["Metoprolol 47,5 mg 1-0-0"]

    chronology = [
        item
        for item in draft.candidates
        if item.target == "examination" and item.normalized.get("section_role") == "chronology"
    ]
    assert [item.normalized["date"] for item in chronology] == ["2024-02-01", "2024-02-03"]
    assert [item.value for item in chronology] == [
        "Erstvorstellung mit Schnittbilddiagnostik",
        "Histologische Sicherung",
    ]

    recommendation = next(item for item in draft.candidates if item.target == "recommendation")
    assert recommendation.value == "Kontrolle in sechs Wochen empfohlen."
    assert "Münchner Onkologie" not in "\n".join(item.value for item in draft.candidates)
    assert "Dr. med. Beispiel" not in "\n".join(item.value for item in draft.candidates)


def test_radiology_keeps_indication_finding_and_impression_separate() -> None:
    draft = parse_clinical_text(RADIOLOGY_REPORT)

    assert draft.document_type == "radiology_report"
    indication = next(item for item in draft.candidates if item.normalized.get("section_role") == "indication")
    finding = next(item for item in draft.candidates if item.normalized.get("section_role") == "finding")
    impression = next(item for item in draft.candidates if item.normalized.get("section_role") == "impression")
    assert indication.target == "anamnesis"
    assert finding.target == "examination"
    assert impression.target == "examination"

    diagnoses = [item for item in draft.candidates if item.target == "diagnosis"]
    assert [item.value for item in diagnoses] == [
        "Verdacht auf fokale Pneumonie.",
        "Kleine Konsolidierung im rechten Unterlappen.",
    ]
    assert diagnoses[0].normalized["certainty"] == "verdacht"
    assert diagnoses[1].normalized["certainty"] == "bestaetigt"
    assert diagnoses[0].normalized["assertion"] == "suspected"
    assert diagnoses[0].selected is False
    assert diagnoses[1].normalized["assertion"] == "confirmed"
    assert diagnoses[1].selected is True
    assert not any("Lungenembolie" in item.value for item in diagnoses)


def test_radiology_drops_wrapped_negation_and_footer_text() -> None:
    draft = parse_clinical_text(
        """
Klinische Angaben:
Verlaufskontrolle.

Befund:
Unveränderter Befund.

Beurteilung:
Zufriedenstellender Verlauf.
Nichts
Beweisendes für eine Filialisierung.
Freundliche Grüße
Dr. med. Beispiel
Dieser Befund ist digital erstellt und ohne Unterschrift gültig.
"""
    )

    assert draft.document_type == "radiology_report"
    assert not [item for item in draft.candidates if item.target == "diagnosis"]
    assert not any("Freundliche Grüße" in item.value for item in draft.candidates)


# Synthetic multi-page prostate MRI letter. Layout mirrors a real radiology
# practice letter: RIS field header, multi-column practice footer, a
# continuation-page header and a numbered impression list; all identities,
# addresses and numbers are invented.
PROSTATE_MRI_LETTER = (
    "Radiologie\n\n"
    "            PAT _ NMuster mann, MaxPAT _ I D4711ACC_N{123}PH_NU  DOC_ID1DOC_NDr. med. Beispiel"
    "PB_DATE01.02.1960S_DATE02.03.2026DATA_END\n"
    "                                                                    Dr. med. Erika Beispiel\n"
    "            MVZ Musterstraße        Musterstraße 1, 80000 München       Dr. med. Hans Probe\n"
    "___\n"
    "                                        München, den 02.03.2026  / abc - abc\n\n"
    "            Sehr geehrter Herr Kollege,\n\n"
    "            vielen Dank für die Überweisung Ihres Patienten, bei dem wir am 02.03.2026\n"
    "            nachfolgende Untersuchungen durchführten:\n\n"
    "            Multiparametrische Hochfeld-MRT der Prostata (Morphologie, Diffusion, Perfusion)\n"
    "            mit intravenöser Kontrastmittelgabe und Auswertung nach PI-RADS V2.\n\n"
    "            Rechtfertigende Indikation: PSA-Wert 12,4 ng/ml, bisher keine Stanzbiopsie. Hinweis auf\n"
    "            Prostatakarzinom? Familiäre Disposition für PCA bekannt.\n\n"
    "            Schichtführung und Sequenzen: sagittal-koronar-axial T2 / axiale Diffusion\n"
    "            einschließlich ADC-Mapping.\n\n"
    "            Befund: Es liegen keine Voruntersuchungen zum Vergleich vor.\n"
    "            Die Prostata ist geringgradig vergrößert, Volumen 40 ml.\n\n\n"
    "             Radiologie am Musterplatz          Radiologie Probestadt          info@radiologie-beispiel.de\n"
    "             Musterstraße 1, 80000 München      Probeweg 2, 80001 München      Tel: 089/000000-0, Fax: 089/000000-1\n"
    "             Radiologie im Beispielhaus         Strahlentherapie Mitte         info@strahlentherapie-beispiel.de\n"
    "                                                     80002 Probehausen\n"
    "\f2. Seite zum Arztbrief Ihres Patienten                         vom 02.03.2026\n\n"
    "Ausgedehnte Tumormanifestation im rechten Seitenlappen mit Kapselüberschreitung.\n\n"
    "Beurteilung:\n"
    "1. Geringe BPH, Prostatavolumen 40 cm3, PSA-Dichte 0,3 ng/ml2 (suspekt > 0,15).\n\n"
    "2. Nachweis eines lokal fortgeschrittenen Prostatakarzinoms im rechten Seitenlappen\n"
    "im Sinne eines Tumorstadiums T3b.\n\n"
    "3. Lymphogene Metastasierung parailiakal beidseits. Multifokale ossäre\n"
    "Metastasierung im Beckenskelett, besonders Os ilium beidseits; soweit in\n"
    "der MRT fassbar, keine akute Frakturgefahr, wobei die Metastasen im Os sacrum\n"
    "durch Computertomographie weiter beurteilt werden sollten.\n\n"
    "Insgesamt PI-RADS 5; nach der Klassifikation somit sehr hohe Wahrscheinlichkeit für das\n"
    "Vorliegen eines klinisch relevanten Prostatakarzinoms.\n\n"
    "Procedere: Gezielte Stanzbiopsie empfohlen; PSMA PET-CT zum Staging wurde bereits\n"
    "vereinbart.\n\n"
    'Für      Bilder     und     Befund     dieser     Untersuchun      klicken     Sie     auf     unserer      Homepa    e     "Patienten-PORTAL",     danach\n'
    '"Login Befundabfrage" oder direkt hier:\n'
    "\f3. Seite zum Arztbrief Ihres Patienten                         vom 02.03.2026\n"
    "\f4. Seite zum Arztbrief Ihres Patienten                         vom 02.03.2026\n\n"
    "Mit freundlichen kollegialen Grüßen\n\n"
    "Dr. med. Beispiel\n"
)


def _prostate_letter_candidates():
    return parse_clinical_text(PROSTATE_MRI_LETTER)


def test_radiology_letter_keeps_practice_footer_and_page_headers_out_of_blocks() -> None:
    draft = _prostate_letter_candidates()

    assert draft.document_type == "radiology_report"
    noise = ("Musterplatz", "info@", "Tel:", "Probehausen", "Seite zum Arztbrief", "Befundabfrage", "PORTAL")
    for candidate in draft.candidates:
        assert not any(token in candidate.value for token in noise), candidate.value
    finding = next(item for item in draft.candidates if item.normalized.get("section_role") == "finding")
    assert "Kapselüberschreitung" in finding.value
    recommendation = next(item for item in draft.candidates if item.target == "recommendation")
    assert recommendation.value.endswith("PSMA PET-CT zum Staging wurde bereits\nvereinbart.")


def test_radiology_letter_review_text_has_no_trailing_practice_footer() -> None:
    draft = _prostate_letter_candidates()
    pages = draft.raw_text.split("\f")

    assert len(pages) == 4
    for token in ("Musterplatz", "info@", "Tel:", "Probehausen"):
        assert token not in draft.raw_text, token
    assert pages[0].rstrip().endswith("Volumen 40 ml.")
    # The letterhead row inside the page and the content of later pages stay.
    assert "MVZ Musterstraße" in pages[0]
    assert "Seite zum Arztbrief" in pages[1]
    assert "Mit freundlichen kollegialen Grüßen" in pages[3]


def test_review_text_keeps_an_address_row_that_does_not_end_the_page() -> None:
    draft = parse_clinical_text(
        "Praxis Beispiel      Musterstraße 1, 80000 München      Tel: 089/000000-0\n\n"
        "Befund:\nProstata vergrößert.\n"
    )

    assert "Musterstraße 1" in draft.raw_text
    assert draft.raw_text.rstrip().endswith("Prostata vergrößert.")


def test_radiology_rads_category_is_not_proposed_as_a_diagnosis() -> None:
    draft = _prostate_letter_candidates()
    diagnoses = [item.value for item in draft.candidates if item.target == "diagnosis"]

    assert not any("PI-RADS" in value for value in diagnoses), diagnoses
    impression = next(
        item for item in draft.candidates if item.normalized.get("section_role") == "impression"
    )
    assert "Insgesamt PI-RADS 5" in impression.value

    # A finding that merely carries its category remains a diagnosis.
    finding = parse_clinical_text(
        PROSTATE_MRI_LETTER.replace(
            "Insgesamt PI-RADS 5; nach der Klassifikation somit sehr hohe Wahrscheinlichkeit für das\n"
            "Vorliegen eines klinisch relevanten Prostatakarzinoms.",
            "4. Herdbefund der peripheren Zone links, PI-RADS 4.",
        )
    )
    assert any(
        item.value.startswith("Herdbefund der peripheren Zone links")
        for item in finding.candidates
        if item.target == "diagnosis"
    )


def test_radiology_letter_numbered_impression_keeps_every_item() -> None:
    diagnoses = [item for item in _prostate_letter_candidates().candidates if item.target == "diagnosis"]
    values = [item.value for item in diagnoses]

    assert not any(re.search(r"\s\d{1,2}\.$", value) for value in values), values
    assert any(value.startswith("Multifokale ossäre Metastasierung im Beckenskelett") for value in values), values
    assert not any("keine akute Frakturgefahr" in value for value in values), values
    assert not any(value.startswith("soweit") for value in values), values
    bph = next(item for item in diagnoses if item.value.startswith("Geringe BPH"))
    # "(suspekt > 0,15)" is the reference threshold of the PSA density, not a
    # suspected diagnosis.
    assert bph.normalized["assertion"] == "confirmed"
    assert bph.selected is True


def test_radiology_letter_reads_justifying_indication_and_psa() -> None:
    draft = _prostate_letter_candidates()

    indication = next(item for item in draft.candidates if item.normalized.get("section_role") == "indication")
    assert indication.target == "anamnesis"
    assert "Familiäre Disposition für PCA" in indication.value
    assert "Schichtführung" not in indication.value
    assert not any("ADC-Mapping" in item.value for item in draft.candidates)

    psa = next(item for item in draft.candidates if item.target == "lab_result")
    assert psa.normalized["analyte_name"] == "PSA"
    assert psa.normalized["numeric_result"] == 12.4
    assert psa.normalized["unit"] == "ng/ml"
    assert psa.selected is False
    assert "laboratory_date_requires_confirmation" in psa.normalized["review_reasons"]


def test_radiology_letter_names_examination_blocks_after_the_study() -> None:
    examinations = [item for item in _prostate_letter_candidates().candidates if item.target == "examination"]

    assert {item.normalized["title"] for item in examinations} == {
        "Multiparametrische Hochfeld-MRT der Prostata — Befund",
        "Multiparametrische Hochfeld-MRT der Prostata — Beurteilung",
    }


def test_radiology_letter_reads_ris_header_birth_date_and_identifier() -> None:
    subject = _prostate_letter_candidates().subject

    assert subject is not None
    assert subject.birth_date == "1960-02-01"
    assert subject.patient_identifier == "4711"
    # The text layer splits the surname ("Muster mann"); a guessed name would
    # be false identity evidence, so only the reliable fields are used.
    assert subject.last_name is None


def test_footer_rules_keep_dose_lines_and_multi_column_table_rows() -> None:
    medications = [
        item.value
        for item in parse_clinical_text(
            "Entlassungsbrief\n\nMedikation:\nPantoprazol 40 mg 1-0-0\n20000 IE Dekristol\n"
            "Ramipril 5 mg 1-0-0\n\nWeitere Hinweise folgen.\n\n\n"
        ).candidates
        if item.target == "medication"
    ]
    assert any("Dekristol" in value for value in medications), medications

    finding = next(
        item
        for item in parse_clinical_text(
            "Befund:\nLeukozyten      10500 Zellen/µl     geringgradig erhöht\n"
            "Ferritin        12000 Ng     Ringversuch bestanden\n"
        ).candidates
        if item.target == "examination"
    )
    assert "geringgradig erhöht" in finding.value
    assert "Ringversuch" in finding.value


def test_surgical_technique_section_is_not_treated_as_imaging_protocol() -> None:
    draft = parse_clinical_text(
        "Befund:\nGallenblase entzündlich verändert.\n"
        "Technik: Laparoskopische Cholezystektomie, Bergung im Bergebeutel.\n"
    )

    finding = next(item for item in draft.candidates if item.target == "examination")
    assert "Laparoskopische Cholezystektomie" in finding.value


def test_indication_does_not_label_free_psa_as_total_psa() -> None:
    draft = parse_clinical_text(
        "Indikation: Gesamt-PSA 8,0 ng/ml, freies PSA 1,2 ng/ml.\n\nBefund:\nProstata unauffällig.\n"
    )

    labs = [item.normalized["result_text"] for item in draft.candidates if item.target == "lab_result"]
    assert labs == ["8,0"]


def test_medication_written_dose_first_starts_a_new_drug() -> None:
    rows = [
        item
        for item in parse_clinical_text(
            "Entlassungsbrief\n\nMedikation:\nPantoprazol 40 mg 1-0-0\n20000 IE Dekristol\n"
            "Ramipril 5 mg 1-0-0\n\nWeitere Hinweise folgen.\n\n\n"
        ).candidates
        if item.target == "medication"
    ]
    assert [item.value for item in rows[:3]] == [
        "Pantoprazol 40 mg 1-0-0",
        "20000 IE Dekristol",
        "Ramipril 5 mg 1-0-0",
    ]
    note = next(item for item in rows if item.value == "Weitere Hinweise folgen.")
    assert note.selected is False
    assert "medication_row_without_dose_or_schedule" in note.normalized["review_reasons"]


def test_wrapped_dose_and_form_still_continue_the_previous_drug() -> None:
    values = [
        item.value
        for item in parse_clinical_text("Medikation:\nPantoprazol\n40 mg Tabletten 1-0-0\nRamipril 5 mg 1-0-0\n").candidates
        if item.target == "medication"
    ]
    assert values == ["Pantoprazol 40 mg Tabletten 1-0-0", "Ramipril 5 mg 1-0-0"]


def test_radiology_examinations_carry_the_study_date() -> None:
    examinations = [item for item in _prostate_letter_candidates().candidates if item.target == "examination"]

    assert {item.normalized.get("performed_on") for item in examinations} == {"2026-03-02"}


def test_recommendation_drops_requests_to_the_referring_doctor() -> None:
    recommendation = next(
        item
        for item in parse_clinical_text(
            "Befund:\nProstata vergrößert.\n\n"
            "Procedere: Gezielte Stanzbiopsie empfohlen. Im Falle einer Stanzbiopsie\n"
            "Histologiebefund bitte per Fax an 089 / 000000-1 oder per Mail an\n. Vielen Dank.\n"
        ).candidates
        if item.target == "recommendation"
    )

    assert recommendation.value == "Gezielte Stanzbiopsie empfohlen."
    assert recommendation.normalized["description"] == "Gezielte Stanzbiopsie empfohlen."
    assert "per Fax" in recommendation.source.text
