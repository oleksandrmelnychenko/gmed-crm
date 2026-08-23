from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import re
import unicodedata


@dataclass(frozen=True)
class DocumentNameSuggestion:
    auto_name: str
    specialty_code: str
    document_type: str
    document_date: date | None
    source_person: str | None
    source_institution: str | None
    category: str
    is_medical: bool


_SPECIALTY_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("KARDCH", ("kardiochir", "herzchir", "cardiac surgery", "cardiothoracic")),
    ("DERMCH", ("dermatochir", "dermatologische chirurgie", "skin surgery")),
    ("GYNCH", ("gynakologische chirurgie", "gynaekologische chirurgie", "gyn surgery")),
    ("AUGCH", ("ophthalmochir", "augenchir", "ophthalmic surgery")),
    ("NEURCH", ("neurochir", "neurosurg")),
    ("UROCH", ("urochir", "urologische chirurgie", "urologic surgery")),
    ("ENDOCH", ("endokrine chirurgie", "endokrinologische chirurgie", "endocrine surgery")),
    ("PLASTCHIR", ("plastische chirurgie", "plastic surgery", "plastisch-rekonstruktiv")),
    ("VASK", ("gefasschir", "angiolog", "vascular surgery")),
    ("UNFAL", ("unfallchir", "traumatolog", "trauma surgery")),
    ("MKG", ("mund-kiefer-gesicht", "kieferchir", "maxillofacial")),
    ("KFO", ("kieferorthop", "orthodont")),
    ("HISTO/PATHO", ("histolog", "patholog", "biopsie", "biopsy")),
    ("PHYSIO/REHA", ("physiotherap", "rehabilitation", "rehaklinik", "reha ")),
    ("PNEUMO/RESP", ("pneumolog", "pulmonolog", "lungenarzt", "respiratory", "bronchoskop")),
    ("GASTRO", ("gastroenterolog", "gastroskop", "koloskop", "colonoscop", "magen-darm")),
    ("ONKO", ("onkolog", "oncolog", "tumorzentrum", "chemotherap")),
    ("KARDIO", ("kardiolog", "cardiolog", "herzzentrum", "echokardi", "koronar")),
    ("DERMA", ("dermatolog", "hautarzt", "hautklinik")),
    ("RAD", ("radiolog", "radiology", "magnetresonan", "kernspintom", "pet-ct", "rontgen")),
    ("LAB", ("laborbefund", "laborergebnis", "lab results", "laboratorium")),
    ("NEURO", ("neurolog", "neurology", "epilep", "multiple sklerose")),
    ("CHIR", ("chirurg", "surgery", "operationsbericht", "op-bericht")),
    ("GYN", ("gynakolog", "gynaekolog", "frauenarzt", "geburtshilfe")),
    ("AUGE", ("ophthalmolog", "augenarzt", "augenklinik")),
    ("HÄMAT", ("hamatolog", "haematolog", "hematolog")),
    ("URO", ("urolog", "prostata", "harnblase")),
    ("SCHLAF", ("schlaflabor", "schlafmedizin", "polysomnograph")),
    ("ENDO", ("endokrinolog", "schilddruse", "diabetolog")),
    ("ORTHOL", ("orthopad", "orthopaed", "orthopedic")),
    ("DENT", ("zahnarzt", "zahnmedizin", "dental")),
    ("PÄD", ("kinderheil", "padiatr", "paediatr", "pediatric")),
    ("HNO", ("hals-nasen-ohren", "hno-klinik", "otorhinolaryng", "ent clinic")),
    ("INFEKT", ("infektiolog", "infectious disease")),
    ("ANA", ("anasthesi", "anaesthes", "anesthes")),
    ("NEPHRO", ("nephrolog", "nierenzentrum", "dialyse")),
    ("PSYCH", ("psychiatr", "psychotherap", "mental health")),
    ("PROKTO", ("proktolog", "coloproctolog")),
    ("RHEUM", ("rheumatolog", "rheumatic")),
    ("GER", ("geriatr", "geriatric")),
    ("ALLMED", ("allgemeinmedizin", "hausarzt", "general practice", "family medicine")),
)

_CATEGORY_SPECIALTY_CODES: dict[str, str] = {
    "medical_gastro": "GASTRO",
    "medical_onko": "ONKO",
    "medical_kardio": "KARDIO",
    "medical_kardch": "KARDCH",
    "medical_derma": "DERMA",
    "medical_dermch": "DERMCH",
    "medical_radiology": "RAD",
    "medical_lab": "LAB",
    "medical_patho_histo": "HISTO/PATHO",
    "medical_neuro": "NEURO",
    "medical_neurch": "NEURCH",
    "medical_chir": "CHIR",
    "medical_gyn": "GYN",
    "medical_gynch": "GYNCH",
    "medical_auge": "AUGE",
    "medical_augch": "AUGCH",
    "medical_hamat": "HÄMAT",
    "medical_uro": "URO",
    "medical_uroch": "UROCH",
    "medical_schlaf": "SCHLAF",
    "medical_endo": "ENDO",
    "medical_endoch": "ENDOCH",
    "medical_vask": "VASK",
    "medical_orthol": "ORTHOL",
    "medical_unfal": "UNFAL",
    "medical_mkg": "MKG",
    "medical_dent": "DENT",
    "medical_kfo": "KFO",
    "medical_plastchir": "PLASTCHIR",
    "medical_pad": "PÄD",
    "medical_physio_reha": "PHYSIO/REHA",
    "medical_hno": "HNO",
    "medical_infekt": "INFEKT",
    "medical_ana": "ANA",
    "medical_nephro": "NEPHRO",
    "medical_psych": "PSYCH",
    "medical_pneumo_resp": "PNEUMO/RESP",
    "medical_prokto": "PROKTO",
    "medical_rheum": "RHEUM",
    "medical_ger": "GER",
    "medical_allmed": "ALLMED",
}

_DOCUMENT_TYPE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Entlassungsbrief", ("entlassungsbrief", "entlassbericht", "discharge letter", "discharge summary")),
    ("Arztbrief", ("arztbrief", "arztlicher brief", "medical letter", "doctor's letter")),
    ("Histologischer Befund", ("histologischer befund", "histology report")),
    ("Pathologischer Befund", ("pathologischer befund", "pathology report")),
    ("Laborbefund", ("laborbefund", "laborergebnis", "laborbericht", "lab report", "lab results")),
    ("Radiologischer Befund", ("radiologischer befund", "mrt-befund", "mrt befund", "ct-befund", "ct befund", "radiology report")),
    ("OP-Bericht", ("operationsbericht", "op-bericht", "operative report")),
    ("Befundbericht", ("befundbericht", "diagnostic report")),
    ("Befund", ("befund", "untersuchungsergebnis", "findings")),
    ("Gutachten", ("gutachten", "expert opinion")),
    ("Verordnung", ("verordnung", "prescription")),
    ("Überweisung", ("uberweisung", "referral")),
    ("Rechnung", ("rechnung", "invoice")),
    ("Kostenvoranschlag", ("kostenvoranschlag", "cost estimate")),
    ("Zahlungsbeleg", ("zahlungsbeleg", "payment proof", "uberweisungsbeleg")),
    ("Versicherungsunterlage", ("versicherung", "insurance document", "versicherungsnachweis")),
    ("Korrespondenz", ("korrespondenz", "correspondence")),
)

_GENERIC_ARTS = {
    "",
    "report",
    "document",
    "uploaded document",
    "uploaded_document",
    "patient upload",
    "patient_upload",
    "patient medical upload",
    "patient_medical_upload",
    "patient correspondence upload",
    "patient_correspondence_upload",
    "patient analysis upload",
    "patient_analysis_upload",
    "patient conclusion upload",
    "patient_conclusion_upload",
}

_INSTITUTION_MARKERS = (
    "klinikum",
    "klinik",
    "krankenhaus",
    "hospital",
    "universitat",
    "university",
    "medizinisches zentrum",
    "medical center",
    "mvz",
    "arztpraxis",
    "gemeinschaftspraxis",
    "labor ",
    "laboratorium",
    "institut fur",
)

_DATE_PATTERN = re.compile(r"(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?!\d)")
_ISO_DATE_PATTERN = re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")


def suggest_document_name(
    *,
    extracted_text: str,
    original_filename: str | None,
    art: str | None,
    category: str | None,
    is_medical: bool,
    patient_name: str | None,
) -> DocumentNameSuggestion:
    filename_stem = _filename_stem(original_filename)
    evidence = "\n".join(part for part in (filename_stem, category or "", art or "", extracted_text[:30_000]) if part)
    normalized_evidence = _normalize_lookup(evidence)
    specialty_code = _CATEGORY_SPECIALTY_CODES.get((category or "").strip().casefold(), "")
    if not specialty_code:
        specialty_code = _find_specialty_code(normalized_evidence)
    document_type = _find_document_type(normalized_evidence, art, filename_stem)
    detected_date = _find_document_date(extracted_text)
    source_person = _find_source_person(extracted_text)
    source_institution = _find_source_institution(extracted_text)
    medical = is_medical or bool(specialty_code) or _looks_medical(normalized_evidence)
    code = specialty_code or _category_code(category, art, medical)
    patient = _clean_part(patient_name) or "Patient"
    type_and_date = document_type
    if detected_date is not None:
        type_and_date = f"{type_and_date} vom {detected_date:%d.%m.%Y}"
    source = _compact_party(source_person, source_institution)
    parts = [code, type_and_date, source, patient]
    auto_name = "-".join(part for part in (_clean_part(value) for value in parts) if part)
    if len(auto_name) > 255:
        auto_name = auto_name[:252].rstrip(" ,-_") + "..."
    category_value = _specialty_category(specialty_code) if specialty_code else (category or ("medical" if medical else "other"))
    return DocumentNameSuggestion(
        auto_name=auto_name,
        specialty_code=code,
        document_type=document_type,
        document_date=detected_date,
        source_person=source_person,
        source_institution=source_institution,
        category=category_value,
        is_medical=medical,
    )


def _normalize_lookup(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", without_marks.casefold()).strip()


def _find_specialty_code(evidence: str) -> str:
    for code, keywords in _SPECIALTY_RULES:
        if any(keyword in evidence for keyword in keywords):
            return code
    if re.search(r"\b(mrt|mri|ct|pet|rontgen)\b", evidence):
        return "RAD"
    if re.search(r"\b(labor|lab)\b", evidence):
        return "LAB"
    return ""


def _find_document_type(evidence: str, art: str | None, filename_stem: str) -> str:
    for label, keywords in _DOCUMENT_TYPE_RULES:
        if any(keyword in evidence for keyword in keywords):
            return label
    cleaned_art = _humanize_art(art)
    if _normalize_lookup(cleaned_art) not in _GENERIC_ARTS:
        return cleaned_art
    cleaned_stem = _clean_part(filename_stem)
    if cleaned_stem and not re.fullmatch(r"(?:scan|img|document|dok|file)[-_ ]?\d*", _normalize_lookup(cleaned_stem)):
        return cleaned_stem[:80]
    return "Dokument"


def _find_document_date(text: str) -> date | None:
    lines = [_clean_part(line) for line in text.splitlines()[:160]]
    lines = [line for line in lines if line]
    priority = [
        line
        for line in lines
        if any(marker in _normalize_lookup(line) for marker in ("erstelldatum", "berichtsdatum", "befunddatum", "datum", "date", " vom "))
        and not any(marker in _normalize_lookup(line) for marker in ("geburtsdatum", "geboren", "birth"))
    ]
    for line in (*priority, *lines):
        if any(marker in _normalize_lookup(line) for marker in ("geburtsdatum", "geboren", "birth")):
            continue
        parsed = _parse_date_from_line(line)
        if parsed is not None:
            return parsed
    return None


def _parse_date_from_line(line: str) -> date | None:
    for match in _ISO_DATE_PATTERN.finditer(line):
        parsed = _safe_date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        if parsed is not None:
            return parsed
    for match in _DATE_PATTERN.finditer(line):
        year = int(match.group(3))
        if year < 100:
            year += 2000 if year < 70 else 1900
        parsed = _safe_date(year, int(match.group(2)), int(match.group(1)))
        if parsed is not None:
            return parsed
    return None


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        value = date(year, month, day)
    except ValueError:
        return None
    if value.year < 1900 or value > datetime.now().date():
        return None
    return value


def _find_source_person(text: str) -> str | None:
    title_pattern = re.compile(
        r"\b(?:prof\.?|dr\.?|pd\s+dr\.?)\s+(?:med\.?\s+)?[^\r\n|]{2,80}",
        re.IGNORECASE,
    )
    for raw_line in text.splitlines()[:140]:
        line = _clean_part(raw_line)
        if not line or len(line) > 140 or _looks_like_patient_line(line):
            continue
        match = title_pattern.search(line)
        if match:
            candidate = re.split(r"\s{2,}|\||;", match.group(0))[0]
            return _clean_part(candidate.rstrip(","))[:100] or None
    return None


def _find_source_institution(text: str) -> str | None:
    for raw_line in text.splitlines()[:140]:
        line = _clean_part(raw_line)
        normalized = _normalize_lookup(line)
        if not line or len(line) > 140 or _looks_like_patient_line(line):
            continue
        if any(marker in normalized for marker in _INSTITUTION_MARKERS):
            return line[:120]
    return None


def _looks_like_patient_line(line: str) -> bool:
    normalized = _normalize_lookup(line)
    return any(marker in normalized for marker in ("patient:", "patientin:", "name des patient", "geburtsdatum"))


def _looks_medical(evidence: str) -> bool:
    return any(
        marker in evidence
        for marker in ("arztbrief", "befund", "diagnose", "anamnes", "therapie", "medikation", "klinikum")
    )


def _category_code(category: str | None, art: str | None, medical: bool) -> str:
    evidence = _normalize_lookup(" ".join(filter(None, (category, art))))
    if medical:
        return "MED"
    if any(marker in evidence for marker in ("invoice", "rechnung", "finance", "payment", "kosten")):
        return "FIN"
    if any(marker in evidence for marker in ("passport", "reisepass", "identity", "personal")):
        return "PERS"
    if any(marker in evidence for marker in ("amt", "official", "authority", "visa")):
        return "AMT"
    if any(marker in evidence for marker in ("insurance", "versicherung")):
        return "VERS"
    if any(marker in evidence for marker in ("contract", "vertrag", "auftrag")):
        return "VERTRAG"
    if any(marker in evidence for marker in ("translation", "ubersetzung")):
        return "UEB"
    if any(marker in evidence for marker in ("admin", "portal", "correspondence", "korrespondenz")):
        return "ADMIN"
    return "DOK"


def _specialty_category(code: str) -> str:
    for category, specialty_code in _CATEGORY_SPECIALTY_CODES.items():
        if specialty_code == code:
            return category
    normalized = re.sub(r"[^a-z0-9]+", "_", _normalize_lookup(code)).strip("_")
    return f"medical_{normalized}"


def _humanize_art(value: str | None) -> str:
    cleaned = _clean_part((value or "").replace("_", " "))
    if not cleaned:
        return "Dokument"
    return cleaned[0].upper() + cleaned[1:]


def _filename_stem(filename: str | None) -> str:
    value = (filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    return value.rsplit(".", 1)[0] if "." in value else value


def _compact_party(*parts: str | None) -> str:
    values: list[str] = []
    seen: set[str] = set()
    for part in parts:
        cleaned = _clean_part(part)
        key = _normalize_lookup(cleaned)
        if cleaned and key not in seen:
            values.append(cleaned)
            seen.add(key)
    return ", ".join(values)


def _clean_part(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip(" ,-_")
