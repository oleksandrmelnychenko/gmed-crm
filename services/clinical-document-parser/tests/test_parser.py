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


def test_unknown_layout_is_reviewable_instead_of_guessing() -> None:
    draft = parse_clinical_text("Freier Text ohne bekannte medizinische Abschnittsüberschriften")

    assert draft.candidates == []
    assert draft.warnings


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
