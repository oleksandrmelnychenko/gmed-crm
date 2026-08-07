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
