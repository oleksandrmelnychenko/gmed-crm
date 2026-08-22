from datetime import date

from app.naming import suggest_document_name


def test_builds_kardio_name_from_document_metadata() -> None:
    suggestion = suggest_document_name(
        extracted_text="""
        Klinikum rechts der Isar
        Klinik für Kardiologie
        Arztbrief vom 11.11.2020
        Prof. Dr. med. A. Smidt
        Patient: J. Smith
        """,
        original_filename="scan-001.pdf",
        art="report",
        category="medical",
        is_medical=True,
        patient_name="J. Smith",
    )

    assert suggestion.specialty_code == "KARDIO"
    assert suggestion.document_type == "Arztbrief"
    assert suggestion.document_date == date(2020, 11, 11)
    assert suggestion.category == "medical_kardio"
    assert suggestion.auto_name == (
        "KARDIO-Arztbrief vom 11.11.2020-Prof. Dr. med. A. Smidt, "
        "Klinikum rechts der Isar-J. Smith"
    )


def test_uses_specific_surgical_specialty_before_parent_specialty() -> None:
    suggestion = suggest_document_name(
        extracted_text="Klinik für Kardiochirurgie\nOP-Bericht\nDatum 04.06.2026",
        original_filename="document.pdf",
        art="uploaded_document",
        category="medical",
        is_medical=True,
        patient_name="Anna Müller",
    )

    assert suggestion.specialty_code == "KARDCH"
    assert suggestion.document_type == "OP-Bericht"
    assert suggestion.auto_name.startswith("KARDCH-OP-Bericht vom 04.06.2026")


def test_does_not_use_birth_date_as_document_date() -> None:
    suggestion = suggest_document_name(
        extracted_text="Patient: Anna Müller\nGeburtsdatum: 03.02.1985\nLaborbefund",
        original_filename="labor.pdf",
        art="report",
        category="lab_analysis",
        is_medical=True,
        patient_name="Anna Müller",
    )

    assert suggestion.specialty_code == "LAB"
    assert suggestion.document_date is None
    assert "03.02.1985" not in suggestion.auto_name


def test_financial_document_uses_fin_prefix_without_medical_claim() -> None:
    suggestion = suggest_document_name(
        extracted_text="Rechnung Nr. 123\nDatum: 12.08.2026",
        original_filename="invoice.pdf",
        art="patient_invoice_upload",
        category="invoice",
        is_medical=False,
        patient_name="Max Mustermann",
    )

    assert suggestion.specialty_code == "FIN"
    assert suggestion.document_type == "Rechnung"
    assert suggestion.is_medical is False
    assert suggestion.auto_name == "FIN-Rechnung vom 12.08.2026-Max Mustermann"


def test_supports_the_complete_medical_specialty_abbreviation_catalog() -> None:
    cases = {
        "GASTRO": "Gastroenterologie",
        "ONKO": "Onkologie",
        "KARDIO": "Kardiologie",
        "KARDCH": "Kardiochirurgie",
        "DERMA": "Dermatologie",
        "DERMCH": "Dermatologische Chirurgie",
        "RAD": "Radiologie MRT Befund",
        "LAB": "Laborbefund",
        "HISTO/PATHO": "Histologischer Befund",
        "NEURO": "Neurologie",
        "NEURCH": "Neurochirurgie",
        "CHIR": "Chirurgie",
        "GYN": "Gynäkologie",
        "GYNCH": "Gynäkologische Chirurgie",
        "AUGE": "Ophthalmologie",
        "AUGCH": "Augenchirurgie",
        "HÄMAT": "Hämatologie",
        "URO": "Urologie",
        "UROCH": "Urologische Chirurgie",
        "SCHLAF": "Schlaflabor",
        "ENDO": "Endokrinologie",
        "ENDOCH": "Endokrine Chirurgie",
        "VASK": "Gefäßchirurgie",
        "ORTHOL": "Orthopädie",
        "UNFAL": "Unfallchirurgie",
        "MKG": "Mund-Kiefer-Gesichtschirurgie",
        "DENT": "Zahnarzt Zahnmedizin",
        "KFO": "Kieferorthopädie",
        "PLASTCHIR": "Plastische Chirurgie",
        "PÄD": "Kinderheilkunde Pädiatrie",
        "PHYSIO/REHA": "Physiotherapie Rehabilitation",
        "HNO": "Hals-Nasen-Ohren-Heilkunde",
        "INFEKT": "Infektiologie",
        "ANA": "Anästhesie",
        "NEPHRO": "Nephrologie",
        "PSYCH": "Psychiatrie",
        "PNEUMO/RESP": "Pneumologie Lungenarzt",
        "PROKTO": "Proktologie",
        "RHEUM": "Rheumatologie",
        "GER": "Geriatrie",
        "ALLMED": "Allgemeinmedizin Hausarzt",
    }

    for expected_code, specialty_text in cases.items():
        suggestion = suggest_document_name(
            extracted_text=f"{specialty_text}\nBefund",
            original_filename="scan.pdf",
            art="report",
            category="medical",
            is_medical=True,
            patient_name="Test Patient",
        )
        assert suggestion.specialty_code == expected_code, specialty_text
