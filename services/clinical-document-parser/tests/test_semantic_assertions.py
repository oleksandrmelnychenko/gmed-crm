from app.parser import parse_clinical_text


def _items(text: str, *, target: str | None = None):
    candidates = parse_clinical_text(text).candidates
    if target is None:
        return candidates
    return [item for item in candidates if item.target == target]


def test_all_supported_german_negation_forms_are_not_active_diagnoses() -> None:
    phrases = [
        "Kein Hinweis auf Herzinsuffizienz",
        "Ohne pulmonale Metastasen",
        "Dyspnoe verneint",
        "Unauffälliger Klappenbefund",
        "Regelrechte Ventrikelfunktion",
    ]

    for phrase in phrases:
        candidates = _items(f"Diagnosen\n{phrase}")
        assert not [item for item in candidates if item.target == "diagnosis"], phrase
        finding = next(item for item in candidates if item.value == phrase)
        assert finding.target == "examination"
        assert finding.normalized["assertion"] == "negated"
        assert finding.normalized["semantic_role"] == "negative_finding"
        assert finding.normalized["auto_select"] is False
        assert finding.selected is False
        assert finding.source.text == phrase


def test_rule_out_is_preserved_as_review_evidence_not_as_a_diagnosis() -> None:
    candidates = _items("Diagnosen\nAusschluss einer Lungenembolie")

    assert not [item for item in candidates if item.target == "diagnosis"]
    rule_out = candidates[0]
    assert rule_out.target == "examination"
    assert rule_out.normalized["assertion"] == "rule_out"
    assert rule_out.normalized["semantic_role"] == "diagnostic_intent"
    assert rule_out.normalized["review_reasons"] == [
        "rule_out_is_not_an_active_diagnosis"
    ]
    assert rule_out.selected is False


def test_suspicion_markers_create_unselected_suspected_diagnoses() -> None:
    phrases = [
        "V.a. fokale Pneumonie",
        "V. a. fokale Pneumonie",
        "Verdacht auf fokale Pneumonie",
        "Suspekte fokale Pneumonie",
    ]

    for phrase in phrases:
        diagnosis = _items(f"Diagnosen\n{phrase}", target="diagnosis")[0]
        assert diagnosis.normalized["certainty"] == "verdacht"
        assert diagnosis.normalized["assertion"] == "suspected"
        assert diagnosis.normalized["auto_select"] is False
        assert diagnosis.selected is False


def test_personal_and_family_history_are_routed_to_anamnesis() -> None:
    candidates = _items(
        """
Diagnosen
Z.n. Myokardinfarkt
Bei Vater koronare Herzkrankheit
Arterielle Hypertonie
"""
    )

    diagnoses = [item for item in candidates if item.target == "diagnosis"]
    assert [item.value for item in diagnoses] == ["Arterielle Hypertonie"]
    assert diagnoses[0].normalized["assertion"] == "confirmed"
    histories = [item for item in candidates if item.target == "anamnesis"]
    assert [item.normalized["assertion"] for item in histories] == [
        "historical",
        "family_history",
    ]
    assert all(item.selected for item in histories)


def test_family_history_heading_never_creates_a_patient_diagnosis() -> None:
    candidates = _items(
        """
Familienanamnese:
Vater mit koronarer Herzkrankheit, Mutter mit Diabetes mellitus.
"""
    )

    assert not [item for item in candidates if item.target == "diagnosis"]
    history = candidates[0]
    assert history.target == "anamnesis"
    assert history.normalized["section_role"] == "family_history"
    assert history.normalized["assertion"] == "family_history"


def test_encounter_title_is_an_examination_not_a_diagnosis() -> None:
    candidates = _items(
        "Diagnosen\nInternistisch kardiologische Kontrolluntersuchung"
    )

    assert not [item for item in candidates if item.target == "diagnosis"]
    encounter = candidates[0]
    assert encounter.target == "examination"
    assert encounter.normalized["semantic_role"] == "encounter"
    assert encounter.normalized["assertion"] == "documented"
    assert encounter.selected is True


def test_common_discharge_section_aliases_are_recognized() -> None:
    candidates = _items(
        """
Entlassungsdiagnosen
Arterielle Hypertonie
Entlassungsmedikation
Metoprolol 47,5 mg 1-0-0
Weiteres Procedere
Kontrolle in vier Wochen.
"""
    )

    assert [item.target for item in candidates] == [
        "diagnosis",
        "medication",
        "recommendation",
    ]


def test_mixed_positive_and_negative_row_preserves_both_clauses_safely() -> None:
    candidates = _items(
        "Diagnosen\nArterielle Hypertonie, keine Herzinsuffizienz"
    )

    assert [item.value for item in candidates if item.target == "diagnosis"] == [
        "Arterielle Hypertonie"
    ]
    negative = next(item for item in candidates if item.target == "examination")
    assert negative.value == "keine Herzinsuffizienz"
    assert negative.normalized["assertion"] == "negated"
    assert negative.selected is False


def test_confidence_is_evidence_derived_and_explained() -> None:
    candidates = _items(
        """
Diagnosen
Arterielle Hypertonie
Verdacht auf Pneumonie
Ausschluss Lungenembolie
"""
    )

    confidences = {item.value: item.confidence for item in candidates}
    assert len(set(confidences.values())) > 1
    assert all(value not in {0.93, 0.86} for value in confidences.values())
    for item in candidates:
        assert item.normalized["confidence_kind"] == "semantic_classification"
        basis = item.normalized["confidence_basis"]
        assert basis["method"] == "semantic_rules_v1"
        assert basis["signals"]


def test_three_anonymized_report_structures_keep_assertions_separate() -> None:
    cardiology = _items(
        """
Diagnosen
Internistisch kardiologische Kontrolluntersuchung
Beginnende LV-Hypertrophie
Ausschluss Herzinsuffizienz
Anamnese
Die Person stellt sich zur Kontrolle vor.
"""
    )
    oncology = _items(
        """
Onkologische Diagnosen
Kolonkarzinom
Verdacht auf Lebermetastase
Ausschluss pulmonale Metastasierung
Chronologie
01.02.2024 Histologische Sicherung
"""
    )
    radiology = _items(
        """
Klinische Angaben:
Verlaufskontrolle.
Befund:
Kleine Verdichtung.
Beurteilung:
Kein Nachweis einer Lungenembolie.
Verdacht auf fokale Pneumonie.
"""
    )

    for candidates in (cardiology, oncology, radiology):
        diagnoses = [item for item in candidates if item.target == "diagnosis"]
        assert all(item.normalized["assertion"] != "negated" for item in diagnoses)
        assert all("Ausschluss" not in item.value for item in diagnoses)
    assert any(item.normalized.get("semantic_role") == "encounter" for item in cardiology)
    assert any(item.normalized.get("assertion") == "suspected" for item in oncology)
    assert any(item.normalized.get("assertion") == "suspected" for item in radiology)
