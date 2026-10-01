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
