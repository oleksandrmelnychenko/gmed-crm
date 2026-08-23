from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field, replace
from datetime import date
from typing import Any

from . import PARSER_VERSION
from .models import (
    ClinicalCandidate,
    DocumentSubject,
    MAX_SOURCE_EVIDENCE_CHARS,
    ParseDraft,
    SourceEvidence,
    SubjectSourceEvidence,
    Target,
)
from .rules import load_rules


SUPPORTED_TARGETS = {
    "diagnosis",
    "anamnesis",
    "medication",
    "examination",
    "lab_result",
    "vital",
    "recommendation",
}
DATE_AT_START_RE = re.compile(
    r"^\s*(?P<date>\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2}))(?!\d)\s*(?P<text>.*)$"
)
WRAPPED_DATE_RE = re.compile(
    r"^\s*(?P<prefix>\d{1,2}\.\d{1,2}\.)(?P<year>\d)(?P<text>\s+.*)?$"
)

# Candidate confidence describes how strongly the parser evidence supports its
# semantic classification. It is deliberately not a claim about medical truth.
CONFIDENCE_BASE = 0.35
CONFIDENCE_SIGNALS: dict[str, float] = {
    "recognized_heading": 0.20,
    "diagnosis_section": 0.15,
    "section_body": 0.12,
    "specific_section_role": 0.08,
    "coherent_text": 0.08,
    "explicit_positive_context": 0.10,
    "explicit_suspicion": 0.14,
    "explicit_negation": 0.17,
    "explicit_rule_out": 0.16,
    "explicit_history": 0.17,
    "family_history_context": 0.18,
    "encounter_term": 0.16,
    "structured_date": 0.17,
    "radiology_impression": 0.15,
    "dose_pattern": 0.15,
    "structured_medication_row": 0.14,
    "explicit_active_ingredient": 0.12,
    "medication_lifecycle": 0.08,
    "redirected_from_diagnosis": -0.05,
    "requires_clinical_confirmation": -0.10,
    "possible_ocr_artifact": -0.12,
}

SUSPICION_RE = re.compile(
    r"(?:^|[\s:;(])(?:V\s*\.?\s*a\s*\.?|Verdacht(?:\s+auf)?|suspekt(?:e[rsnm]?)?)(?=\s|$|[,:;.])",
    re.IGNORECASE,
)
RULE_OUT_RE = re.compile(
    r"(?:^|[\s:;(])(?:zum\s+)?Ausschluss(?:\s+(?:von|einer?|des))?(?=\s|$|[,:;.])",
    re.IGNORECASE,
)
NEGATION_RE = re.compile(
    r"(?:"
    r"\bkein(?:e|en|em|er|es)?\b|"
    r"\bohne\b|"
    r"\bverneint(?:e[rsnm]?)?\b|"
    r"\bnicht\s+(?:nachweisbar|vorhanden|erkennbar)\b|"
    r"\bnegativ(?:e[rsnm]?)?\s+(?:auf|f[uü]r)\b|"
    r"\bausgeschlossen\b|"
    r"\bnichts\s+beweisend(?:e[rsnm]?)?\b|"
    r"\bunauff[aä]llig(?:e[rsnm]?)?\b|"
    r"\bregelrecht(?:e[rsnm]?)?\b"
    r")",
    re.IGNORECASE,
)
LEADING_NEGATION_RE = re.compile(
    r"^\s*(?:kein(?:e|en|em|er|es)?|ohne|unauff[aä]llig(?:e[rsnm]?)?|"
    r"regelrecht(?:e[rsnm]?)?|negativ(?:e[rsnm]?)?)\b",
    re.IGNORECASE,
)
NEGATED_PREDICATE_RE = re.compile(
    r"\b(?:ausgeschlossen|nicht\s+(?:nachweisbar|vorhanden|erkennbar)|"
    r"verneint(?:e[rsnm]?)?)\b",
    re.IGNORECASE,
)
HISTORY_RE = re.compile(
    r"(?:^|[\s:;(])(?:Z\s*\.?\s*n\s*\.?|Zustand\s+nach|anamnestisch|in\s+der\s+Vorgeschichte)(?=\s|$|[,:;.])",
    re.IGNORECASE,
)
FAMILY_HISTORY_RE = re.compile(
    r"(?:"
    r"\bFamilienanamnese\b|"
    r"\bfamili[aä]re\s+(?:Anamnese|Belastung)\b|"
    r"\bin\s+der\s+Familie\b|"
    r"\bbei\s+(?:Mutter|Vater|Eltern|Bruder|Schwester|Gro[ßs]eltern)\b"
    r")",
    re.IGNORECASE,
)
ENCOUNTER_RE = re.compile(
    r"(?:"
    r"\b(?:Kontroll|Vorsorge|Nachsorge|Aufnahme|Verlaufs)untersuchung\b|"
    r"\b(?:Erst|Wieder)vorstellung\b|"
    r"\b(?:Verlaufs|Nach|Routine)kontrolle\b|"
    r"\b(?:internistisch(?:e[rsnm]?)?\s+)?(?:kardiologisch(?:e[rsnm]?)?|onkologisch(?:e[rsnm]?)?|neurologisch(?:e[rsnm]?)?)\s+Untersuchung\b"
    r")",
    re.IGNORECASE,
)
DEVICE_HISTORY_RE = re.compile(
    r"^\s*(?:implantierter\s+)?(?:Defibrillator|Herzschrittmacher|Port(?:implantation)?)\b",
    re.IGNORECASE,
)
DIAGNOSIS_DETAIL_RE = re.compile(
    r"^(?:Klinik\s*:|(?:prim[aä]r\s+)?erfolgreiche\s+(?:Elektro)?kardioversion\b|"
    r"CHA[\w-]*Score\b)",
    re.IGNORECASE,
)
DIAGNOSIS_CODE_BLOCK_RE = re.compile(r"^(?:ICD(?:-10)?|OPS)\s*:", re.IGNORECASE)

ONCOLOGY_DIAGNOSIS_CONTINUATION_RE = re.compile(
    r"^(?:Kolon\s+ascendens|Rektumkarzinom|UICC\s+Stadium|"
    r"[cpyr]?T\d|[cpyr]?N[+\d]|G\d|R\d|L\d|V\d|Pn\d|"
    r"Immunhistochemisch|Mikrosatelliten|KRAS\b|BRAF\b)",
    re.IGNORECASE,
)
LOWERCASE_CLINICAL_LABEL_RE = re.compile(
    r"^(?:akut|chronisch|subakut|rezidivierend|persistierend|arteriell|"
    r"essentiell|sekundär)[a-zäöüß]*\s+[A-ZÄÖÜ]",
    re.IGNORECASE,
)


@dataclass
class Section:
    target: Target
    heading: str
    text: str
    page: int | None
    line_pages: list[int] = field(default_factory=list)


@dataclass(frozen=True)
class DiagnosisSemantics:
    target: Target
    assertion: str
    semantic_role: str
    certainty: str | None
    auto_select: bool
    review_reasons: tuple[str, ...]
    confidence_signals: tuple[str, ...]


def parse_clinical_text(text: str) -> ParseDraft:
    layout = _normalize_layout_text(text)
    clean = _normalize_text(layout)
    language = _detect_language(clean)
    document_type = _detect_document_type(clean)
    sections = _split_sections(layout)
    admission_date, discharge_date = _document_stay_dates(clean)
    candidates: list[ClinicalCandidate] = _vital_candidates(
        sections,
        document_text=clean,
        admission_date=admission_date,
    )
    candidates.extend(
        _laboratory_candidates(
            layout,
            admission_date=admission_date,
            discharge_date=discharge_date,
            laboratory_name=_laboratory_name(layout),
        )
    )
    warnings: list[str] = []

    for section in sections:
        role = _section_role(section.heading)
        if section.target == "diagnosis":
            candidates.extend(
                _diagnosis_candidates(
                    section,
                    fold_wrapped=(
                        document_type in {"oncology_report", "discharge_summary"}
                        or (
                            document_type == "cardiology_report"
                            and bool(
                                re.search(
                                    r"^\s*(?:\d+|[a-z])[.)]\s+",
                                    section.text,
                                    re.MULTILINE,
                                )
                            )
                        )
                    ),
                )
            )
        elif section.target == "medication":
            medication_rows, section_warnings = _medication_candidates(
                section,
                source_country=_source_country(clean),
                document_date=discharge_date,
            )
            candidates.extend(medication_rows)
            warnings.extend(section_warnings)
        elif role == "chronology":
            candidates.extend(_chronology_candidates(section))
        elif document_type == "oncology_report" and role == "assessment":
            assessment_candidates, assessment_warnings = _oncology_assessment_candidates(section)
            candidates.extend(assessment_candidates)
            warnings.extend(assessment_warnings)
        elif role == "laboratory" and (
            any(
                item.target == "lab_result" and item.source.page == section.page
                for item in candidates
            )
            or re.fullmatch(r"(?:s(?:iehe|\.)\s*)?Anhang\.?", section.text.strip(), re.IGNORECASE)
        ):
            # Structured rows already preserve this section at analyte level.
            # Do not also create one large, duplicate examination paragraph.
            continue
        else:
            candidate = _section_candidate(section)
            if candidate:
                candidates.append(candidate)
            if document_type == "radiology_report" and role == "impression":
                candidates.extend(_radiology_diagnosis_candidates(section))

    if not candidates:
        if document_type == "administrative_cost_estimate":
            warnings.append(
                "Administrative cost estimate recognized; no clinical facts were proposed."
            )
        else:
            warnings.append("No supported clinical sections were recognized; manual review is required.")
    return ParseDraft(
        document_type=document_type,
        source_language=language,
        parser_version=PARSER_VERSION,
        raw_text=clean,
        subject=_extract_document_subject(layout),
        candidates=candidates,
        warnings=list(dict.fromkeys(warnings)),
    )


def _normalize_text(text: str) -> str:
    text = _normalize_layout_text(text)
    # Tabs carry column boundaries from native PDF table extraction. Collapsing
    # them into spaces made laboratory rows impossible to reconstruct reliably.
    text = re.sub(r" {2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _normalize_layout_text(text: str) -> str:
    # OCR engines can occasionally return an unpaired UTF-16 surrogate. It is
    # not valid Unicode and Pydantic/JSON cannot safely serialize it. Preserve
    # the rest of the document and mark only the damaged code point.
    text = re.sub(r"[\ud800-\udfff]", "\ufffd", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


SUBJECT_NAME_TOKEN_PATTERN = r"[A-ZÄÖÜ][A-Za-zÄÖÜäöüßÀ-ÖØ-öø-ÿ'’-]{1,}"
SUBJECT_DOB_RAW_RE = re.compile(
    r"\b(?:Geburtsdatum|geb(?:oren)?\.?)"
    r"(?:\s*/\s*[^:\n]{1,40})?\s*:?\s*"
    r"(?P<date>\d{1,2}\.\d{1,2}\.[0-9Xx-]{2,4})(?!\d)",
    re.IGNORECASE,
)


def _subject_name(value: str) -> tuple[str, str] | None:
    compact = " ".join(value.strip().strip(",;:").split())
    compact = re.sub(
        r"^(?:Herr|Frau|Patient(?:in)?|Dr\.?|Prof\.?)\s+",
        "",
        compact,
        flags=re.IGNORECASE,
    )
    if "," in compact:
        last, first = (part.strip() for part in compact.split(",", 1))
        first_tokens = first.split()
        last_tokens = last.split()
    else:
        tokens = compact.split()
        if len(tokens) < 2:
            return None
        first_tokens = tokens[:-1]
        last_tokens = tokens[-1:]
    token_re = re.compile(rf"^{SUBJECT_NAME_TOKEN_PATTERN}$")
    if not first_tokens or not last_tokens:
        return None
    if not all(token_re.fullmatch(token) for token in (*first_tokens, *last_tokens)):
        return None
    # Initials, redaction placeholders, and generic identity markers must not
    # become patient-match evidence.
    lowered = {token.casefold().strip(".'’-") for token in (*first_tokens, *last_tokens)}
    if lowered & {"nn", "redacted", "anonym", "unbekannt", "patient"}:
        return None
    return " ".join(first_tokens), " ".join(last_tokens)


def _extract_document_subject(text: str) -> DocumentSubject | None:
    occurrences: dict[str, list[tuple[str, float, int, str]]] = {}
    evidence: list[tuple[int, str]] = []
    invalid_birth_date = False

    def add(field: str, value: str, confidence: float, page: int, line: str) -> None:
        occurrences.setdefault(field, []).append((value, confidence, page, line))
        evidence.append((page, line))

    inspected_lines = 0
    for page_number, page_text in enumerate(text.split("\f"), start=1):
        if page_number > 4 or inspected_lines > 120:
            break
        for raw_line in page_text.splitlines():
            line = " ".join(raw_line.split()).strip()
            if not line:
                continue
            inspected_lines += 1
            if inspected_lines > 120:
                break

            first_match = re.match(
                rf"^(?:Vorname|first\s+name)\s*:\s*(?P<value>{SUBJECT_NAME_TOKEN_PATTERN}(?:\s+{SUBJECT_NAME_TOKEN_PATTERN})*)\s*$",
                line,
                re.IGNORECASE,
            )
            if first_match:
                add("first_name", first_match.group("value"), 0.99, page_number, line)

            last_match = re.match(
                rf"^(?:Nachname|Familienname|surname|last\s+name)\s*:\s*(?P<value>{SUBJECT_NAME_TOKEN_PATTERN}(?:\s+{SUBJECT_NAME_TOKEN_PATTERN})*)\s*$",
                line,
                re.IGNORECASE,
            )
            if last_match:
                add("last_name", last_match.group("value"), 0.99, page_number, line)

            full_match = re.match(
                r"^(?:Patient(?:in)?|Patientenname|Name)\s*:\s*(?P<value>.+?)"
                r"(?=\s*,?\s*(?:geb(?:oren)?\.?|Geburtsdatum)\s*:|$)",
                line,
                re.IGNORECASE,
            )
            if full_match:
                name = _subject_name(full_match.group("value"))
                if name:
                    add("first_name", name[0], 0.96, page_number, line)
                    add("last_name", name[1], 0.96, page_number, line)

            salutation = re.match(
                r"^(?!Sehr\b)(?:Herrn?|Frau)\s+(?P<name>.+?)\s*,?\s+"
                r"(?:geb(?:oren)?\.?)\s*:?\s*(?P<date>[^,;\s]{6,14})(?:[\s,]|$)",
                line,
                re.IGNORECASE,
            )
            salutation_identity_rejected = False
            if salutation:
                name = _subject_name(salutation.group("name"))
                birth_date = _normalize_german_date(salutation.group("date"))
                if name and birth_date:
                    add("first_name", name[0], 0.92, page_number, line)
                    add("last_name", name[1], 0.92, page_number, line)
                    add("birth_date", birth_date, 0.98, page_number, line)
                elif name:
                    evidence.append((page_number, line))
                    invalid_birth_date = True
                else:
                    salutation_identity_rejected = True

            dob_match = SUBJECT_DOB_RAW_RE.search(line)
            if dob_match and not salutation_identity_rejected:
                birth_date = _normalize_german_date(dob_match.group("date"))
                if birth_date:
                    add("birth_date", birth_date, 0.99, page_number, line)
                elif re.match(r"^(?:Geburtsdatum|DOB)\b", line, re.IGNORECASE) or full_match:
                    evidence.append((page_number, line))
                    invalid_birth_date = True

            identifier = re.match(
                r"^(?:Patienten(?:nummer|-?ID)|Patient(?:en)?-?Nr\.?|Pat\.?-?Nr\.?)\s*:\s*"
                r"(?P<value>[A-Za-z0-9][A-Za-z0-9./_-]{2,63})\s*$",
                line,
                re.IGNORECASE,
            )
            if identifier:
                add("patient_identifier", identifier.group("value"), 0.99, page_number, line)

    if not occurrences and not invalid_birth_date:
        return None

    result: dict[str, str] = {}
    confidence: dict[str, float] = {}
    conflicting_fields: list[str] = []
    for field, field_occurrences in occurrences.items():
        distinct = list(dict.fromkeys(item[0] for item in field_occurrences))
        if len(distinct) != 1:
            conflicting_fields.append(field)
            continue
        result[field] = distinct[0]
        confidence[field] = max(item[1] for item in field_occurrences)

    unique_evidence = list(dict.fromkeys(evidence))
    pages = list(dict.fromkeys(page for page, _ in unique_evidence))
    source_text = "\n".join(line for _, line in unique_evidence)[:MAX_SOURCE_EVIDENCE_CHARS]
    review_reasons: list[str] = []
    if conflicting_fields:
        review_reasons.append("conflicting_subject_identity")
        review_reasons.extend(f"conflicting_subject_field:{field}" for field in conflicting_fields)
    if invalid_birth_date:
        review_reasons.append("invalid_subject_birth_date")
    conflict = bool(review_reasons)
    return DocumentSubject(
        status="conflict" if conflict else "extracted",
        conflict=conflict,
        **result,
        patient_identifier_namespace=(
            "source_document" if "patient_identifier" in result else None
        ),
        field_confidence=confidence,
        source=SubjectSourceEvidence(
            page=pages[0] if len(pages) == 1 else None,
            text=source_text,
        ),
        review_reasons=review_reasons,
    )


LAB_RESULT_RE = re.compile(
    r"^(?P<comparator><=|>=|<|>|=)?\s*(?P<number>[+-]?(?:\d{1,3}(?:[. ]\d{3})+|\d+)(?:,\d+)?|[+-]?\d+\.\d+)\s*(?P<marker>[*↑↓]|\(\s*[+-]\s*\))?$"
)
LAB_TEXT_RESULT_RE = re.compile(
    r"^(?:neg\.?|pos\.?|negativ|positiv|reaktiv|nicht\s+nachweisbar|nachweisbar|normal|unauff[aä]llig)$",
    re.IGNORECASE,
)
LAB_REFERENCE_RANGE_RE = re.compile(
    r"(?P<low>[+-]?[\d.,]+)\s*(?:-|–|—|bis)\s*(?P<high>[+-]?[\d.,]+)",
    re.IGNORECASE,
)
LAB_REFERENCE_LIMIT_RE = re.compile(r"(?P<comparator><=|>=|<|>)\s*(?P<number>[+-]?[\d.,]+)")
LAB_DATE_RE = re.compile(
    r"(?:Untersuchung|Labor(?:befund)?|Befund|Entnahme)\s+(?:vom|am)\s+(?P<date>\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2}))(?!\d)",
    re.IGNORECASE,
)
LAB_COLUMN_DATE_RE = re.compile(
    r"(?<!\d)(?P<date>\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2}))(?!\d)"
)
LAB_NARRATIVE_VALUE_RE = re.compile(
    r"(?P<analyte>H[aä]moglobin(?:\s*\(Hb\))?|H[aä]matokrit|Thrombozyten|"
    r"Leukozyten|CRP|INR|PTT|TPZ)\s*:?[ \t]*"
    r"(?P<comparator><=|>=|<|>|=)?\s*(?P<number>[+-]?\d+\.\d+|[+-]?(?:\d{1,3}(?:[. ]\d{3})+|\d+)(?:,\d+)?)"
    r"[ \t]*(?P<unit>g/L|g/dl|mg/L|mg/dl|/nL|/nl|/μL|/µL|%|s)?",
    re.IGNORECASE,
)


def _dated_normwert_table_date(page: str) -> str | None:
    """Return the result-column date from a compact German lab-table header.

    Scanned forms often OCR the visual header columns in a different reading
    order, for example ``Testbezeichnung``, then the date, then ``Normwert`` on
    separate lines. Limit the search to the page header so a print date in the
    footer cannot be mistaken for the specimen/result date.
    """

    header_lines: list[str] = []
    for raw_line in page.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if _heading_key(line).startswith(("ausdru", "seite")):
            break
        header_lines.append(line)
        if len(header_lines) == 8:
            break
    header = "\n".join(header_lines)
    analyte_header = re.search(
        r"\b(?:Testbezeichnung|Bezeichnung|Parameter|Messwert|Analyt)\b",
        header,
        re.IGNORECASE,
    )
    if not analyte_header or not re.search(
        r"\b(?:Normwert|Normbereich|Referenzbereich)\b",
        header,
        re.IGNORECASE,
    ):
        return None
    match = LAB_COLUMN_DATE_RE.search(header)
    if match and match.start() < analyte_header.start():
        return None
    return _normalize_german_date(match.group("date")) if match else None


def _parse_localized_number(value: str) -> float | None:
    compact = value.strip().replace(" ", "")
    if not compact:
        return None
    if "," in compact:
        compact = compact.replace(".", "").replace(",", ".")
    elif compact.count(".") == 1 and len(compact.rsplit(".", 1)[1]) == 3:
        compact = compact.replace(".", "")
    try:
        return float(compact)
    except ValueError:
        return None


def _laboratory_date(text: str) -> str | None:
    match = LAB_DATE_RE.search(text)
    return _normalize_german_date(match.group("date")) if match else None


def _laboratory_name(text: str) -> str | None:
    """Extract an explicit laboratory organisation without using section titles."""

    generic_heading = re.compile(
        r"^(?:labor(?:befund|bericht|werte|ergebnisse?)?|laboratorium|"
        r"labormedizin|klinische\s+chemie)(?:\s+(?:vom|am)\b.*)?\s*:?$",
        re.IGNORECASE,
    )
    organisation_marker = re.compile(
        r"(?:\b(?:labor(?:atorium)?|labormedizin|mvz|synlab|ladr|amedes)\b|"
        r"institut\s+f[uü]r\s+(?:laboratoriumsmedizin|klinische\s+chemie))",
        re.IGNORECASE,
    )
    legal_form = re.compile(r"\b(?:GmbH|AG|e\.\s*V\.|MVZ)\b", re.IGNORECASE)
    candidates: list[tuple[int, int, str]] = []
    first_page = text.split("\f", 1)[0]
    for index, raw_line in enumerate(first_page.splitlines()[:80]):
        line = re.sub(r"\s+", " ", raw_line).strip(" \t|•·")
        if not 3 <= len(line) <= 160 or generic_heading.fullmatch(line):
            continue
        if not organisation_marker.search(line):
            continue
        if re.search(r"\b(?:Parameter|Ergebnis|Referenzbereich|Messwert)\b", line, re.IGNORECASE):
            continue
        score = 20 - min(index, 20)
        if re.search(r"\b(?:SYNLAB|LADR|amedes)\b", line, re.IGNORECASE):
            score += 40
        if legal_form.search(line):
            score += 20
        if re.search(r"\b(?:Institut|Zentrum|Klinik|Praxis)\b", line, re.IGNORECASE):
            score += 10
        candidates.append((score, -index, line))
    name = max(candidates, default=(0, 0, ""))[2]
    return name or None


def _document_stay_dates(text: str) -> tuple[str | None, str | None]:
    match = re.search(
        r"(?:station[aä]re\s+Behandlung\s+vom|(?:der|die)\s+sich\s+vom)\s+"
        r"(?P<start>\d{1,2}\.(?:\d{1,2}\.)?(?:\d{4})?)\s*"
        r"(?:bis(?:\s+zum)?|[-–—])\s*"
        r"(?P<end>\d{1,2}\.\d{1,2}\.\d{4})",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None, None
    end = _normalize_german_date(match.group("end"))
    if not end:
        return None, None
    end_year, end_month, _ = end.split("-")
    start_raw = match.group("start")
    if re.fullmatch(r"\d{1,2}\.", start_raw):
        start_raw = f"{start_raw}{int(end_month):02d}.{end_year}"
    elif re.fullmatch(r"\d{1,2}\.\d{1,2}\.", start_raw):
        start_raw = f"{start_raw}{end_year}"
    start = _normalize_german_date(start_raw)
    return start, end


VITAL_NUMBER_PATTERN = r"[+-]?\d+(?:[.,]\d+)?"
VITAL_PLAUSIBLE_RANGES: dict[str, tuple[float, float]] = {
    "bp_systolic": (40.0, 300.0),
    "bp_diastolic": (20.0, 200.0),
    "heart_rate": (20.0, 300.0),
    "temperature_c": (25.0, 45.0),
    "oxygen_saturation": (20.0, 100.0),
    "respiratory_rate": (3.0, 80.0),
    "weight_kg": (1.0, 500.0),
    "height_cm": (20.0, 250.0),
    "bmi": (5.0, 100.0),
}
VITAL_CANONICAL_UNITS = {
    "bp_systolic": "mmHg",
    "bp_diastolic": "mmHg",
    "heart_rate": "bpm",
    "temperature_c": "°C",
    "oxygen_saturation": "%",
    "respiratory_rate": "/min",
    "weight_kg": "kg",
    "height_cm": "cm",
    "bmi": "kg/m²",
}
VITAL_LABEL_RE = re.compile(
    r"\b(?:RR|Blutdruck|blood\s+pressure|Puls|Herzfrequenz|heart\s+rate|HF|Hf|"
    r"Temperatur|temperature|Temp\.?|SpO\s*2|Sauerstoffs[aä]ttigung|oxygen\s+saturation|"
    r"Atemfrequenz|respiratory\s+rate|AF|Gewicht|weight|Entlassgewicht|"
    r"Gr[oö](?:ß|ss)e|Groesse|K[oö]rpergr[oö](?:ß|ss)e|height|BMI)\b",
    re.IGNORECASE,
)
VITAL_DATE_RE = re.compile(
    r"(?<!\d)(?P<date>\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2}))(?!\d)"
    r"(?:\s*(?:um|,)?\s*(?P<hour>[01]?\d|2[0-3])[:.]"
    r"(?P<minute>[0-5]\d)(?:[:.](?P<second>[0-5]\d))?\s*(?:Uhr)?"
    r"\s*(?P<timezone>Z|[+-]\d{2}:?\d{2})?)?",
    re.IGNORECASE,
)
VITAL_DATE_BINDING_RE = re.compile(
    r"(?:\b(?:gemessen|erhoben)\s+(?:am|vom)\s*|"
    r"\b(?:Messung|Messdatum|Erhebungsdatum)\s*:?\s*|"
    r"\b(?:K[oö]rperliche\s+Untersuchung|K[oö]rperma(?:ß|ss)e|"
    r"Vitalwerte|Vitalparameter|RR|Blutdruck|Puls|Herzfrequenz|"
    r"Temperatur|SpO\s*2|Sauerstoffs[aä]ttigung|Atemfrequenz|"
    r"Gewicht|Gr[oö](?:ß|ss)e|BMI)\s+(?:am|vom)\s*)$",
    re.IGNORECASE,
)


def _document_authored_date(text: str) -> str | None:
    """Return only a date explicitly presented as document/letter metadata."""

    patterns = (
        r"(?:Berichtsdatum|Briefdatum|Dokumentdatum|Datum)\s*:?\s*"
        r"(?P<date>\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2}))(?!\d)",
        r"^[^\n\f,]{2,80},\s*(?P<date>\d{1,2}\.\d{1,2}\.\d{4})(?!\d)\s*$",
    )
    dates: list[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, text, re.IGNORECASE | re.MULTILINE):
            normalized = _normalize_german_date(match.group("date"))
            if normalized:
                dates.append(normalized)
    unique = list(dict.fromkeys(dates))
    return unique[0] if len(unique) == 1 else None


def _vital_lines(section: Section) -> list[tuple[str, int | None]]:
    raw_lines = section.text.splitlines()
    pages = section.line_pages or [section.page] * len(raw_lines)
    rows: list[tuple[str, int | None]] = []
    index = 0
    while index < len(raw_lines):
        line = _repair_native_pdf_spacing_artifacts(" ".join(raw_lines[index].split()))
        page = pages[index] if index < len(pages) else section.page
        while (
            line.endswith("-")
            and index + 1 < len(raw_lines)
            and re.match(r"^[a-zäöüß]", raw_lines[index + 1].lstrip(), re.IGNORECASE)
        ):
            index += 1
            line = f"{line[:-1]}{_repair_native_pdf_spacing_artifacts(' '.join(raw_lines[index].split()))}"
        if line:
            rows.append((line, page))
        index += 1
    return rows


def _looks_like_vital_source(value: str) -> bool:
    if VITAL_LABEL_RE.search(value):
        return True
    # German reports frequently put an unlabeled height/weight pair in the
    # opening physical-examination sentence: ``(185 cm, 72,2 kg, BMI ...)``.
    return bool(
        re.search(
            rf"\b{VITAL_NUMBER_PATTERN}\s*(?:cm|m)\b.{0,50}\b{VITAL_NUMBER_PATTERN}\s*kg\b|"
            rf"\b{VITAL_NUMBER_PATTERN}\s*kg\b.{0,50}\b{VITAL_NUMBER_PATTERN}\s*(?:cm|m)\b",
            value,
            re.IGNORECASE,
        )
    )


def _vital_source_clusters(section: Section) -> list[tuple[str, int | None]]:
    lines = _vital_lines(section)
    clusters: list[tuple[str, int | None]] = []
    index = 0
    while index < len(lines):
        line, page = lines[index]
        if not _looks_like_vital_source(line):
            index += 1
            continue
        parts = [line]
        # OCR/native text may wrap exactly between a label and its numeric
        # value (``spO2:\n92%`` or ``AF\n19/min``). Join only that immediate
        # continuation; never merge distant measurements by page or date.
        if index + 1 < len(lines) and (
            re.search(
                r"(?:SpO\s*2|Sauerstoffs[aä]ttigung|Puls|Herzfrequenz|HF|Hf|"
                r"Atemfrequenz|AF|Temperatur|Temp\.?|Gewicht|Gr[oö](?:ß|ss)e)\s*:?\s*$",
                line,
                re.IGNORECASE,
            )
            or re.match(rf"^\s*{VITAL_NUMBER_PATTERN}\s*(?:%|/\s*min|bpm|°?\s*C|kg|cm)\b", lines[index + 1][0], re.IGNORECASE)
        ):
            index += 1
            parts.append(lines[index][0])
        clusters.append((" ".join(parts).strip(), page))
        index += 1
    return clusters


def _clean_vital_number(value: float) -> int | float:
    rounded = round(value, 2)
    return int(rounded) if rounded.is_integer() else rounded


def _vital_date(
    source_text: str,
    section: Section,
    *,
    admission_date: str | None,
    document_date: str | None,
) -> tuple[str | None, list[str], str | None]:
    def explicitly_bound_matches(value: str) -> list[re.Match[str]]:
        matches: list[re.Match[str]] = []
        for match in VITAL_DATE_RE.finditer(value):
            prefix = value[: match.start()]
            suffix = value[match.end() :].lstrip(" \t|,;:-")
            structured_suffix = bool(
                VITAL_LABEL_RE.match(suffix)
                or re.match(
                    rf"^{VITAL_NUMBER_PATTERN}\s*(?:cm|m|kg)\b.{0,50}"
                    rf"{VITAL_NUMBER_PATTERN}\s*(?:cm|m|kg)\b",
                    suffix,
                    re.IGNORECASE,
                )
            )
            # A leading date in a dedicated vital row is structured evidence.
            # Otherwise require an explicit measurement-date binding. This
            # excludes OCR-joined letter headers such as ``Berlin, 01.01.2022
            # RR ...`` from longitudinal history.
            if (not prefix.strip() and structured_suffix) or VITAL_DATE_BINDING_RE.search(prefix):
                matches.append(match)
        return matches

    matches = explicitly_bound_matches(source_text)
    if not matches:
        matches = explicitly_bound_matches(section.heading)
    resolved: list[tuple[str, str | None, bool]] = []
    for match in matches:
        normalized = _normalize_german_date(match.group("date"))
        if not normalized:
            continue
        if match.group("hour") is not None:
            clock = (
                f"{int(match.group('hour')):02d}:"
                f"{int(match.group('minute')):02d}:"
                f"{int(match.group('second') or 0):02d}"
            )
            timezone = match.group("timezone")
            if timezone and timezone != "Z" and ":" not in timezone:
                timezone = f"{timezone[:3]}:{timezone[3:]}"
            if timezone:
                resolved.append((f"{normalized}T{clock}{timezone}", f"{clock}{timezone}", True))
            else:
                # A wall-clock value without an offset must never be silently
                # interpreted as UTC. Preserve it as evidence, retain only the
                # safe date in measured_at, and force review.
                resolved.append((normalized, clock, False))
        else:
            resolved.append((normalized, None, True))
    unique = list(dict.fromkeys(resolved))
    if len(unique) > 1:
        return None, ["conflicting_measured_at"], None
    if unique:
        measured_at, source_time, timezone_safe = unique[0]
        return (
            measured_at,
            [] if timezone_safe else ["ambiguous_measured_at_timezone"],
            source_time,
        )

    heading_key = _heading_key(section.heading)
    if "aufnahme" in heading_key and admission_date:
        return admission_date, [], None
    if document_date and not admission_date and any(
        marker in heading_key
        for marker in (
            "korperlicheuntersuchung",
            "koerperlicheuntersuchung",
            "körperlicheuntersuchung",
            "korpermaße",
            "koerpermasse",
            "körpermaße",
            "vital",
        )
    ):
        # An authored/letter date is useful provenance, but it is not proof
        # that the observation happened that day. Keep it editable and force
        # an explicit reviewer decision before it can enter vital history.
        return document_date, ["inferred_measured_at_from_document_date"], None
    return None, ["missing_measured_at"], None


def _vital_candidates(
    sections: list[Section],
    *,
    document_text: str,
    admission_date: str | None,
) -> list[ClinicalCandidate]:
    rows: list[ClinicalCandidate] = []
    document_date = _document_authored_date(document_text)
    for section in sections:
        if section.target != "examination":
            continue
        for source_text, page in _vital_source_clusters(section):
            normalized, review_reasons = _normalized_vital_measurements(source_text)
            if not normalized:
                continue
            measured_at, date_reasons, source_measured_time = _vital_date(
                source_text,
                section,
                admission_date=admission_date,
                document_date=document_date,
            )
            review_reasons.extend(date_reasons)
            if measured_at:
                normalized["measured_at"] = measured_at
            if source_measured_time:
                normalized["source_measured_time"] = source_measured_time
            normalized.update(
                {
                    "assertion": "documented",
                    "semantic_role": "vital_measurement",
                    "auto_select": not review_reasons,
                    "review_reasons": list(dict.fromkeys(review_reasons)),
                }
            )
            candidate_section = _section_at_page(section, page)
            rows.append(
                _candidate(
                    "vital",
                    source_text,
                    normalized,
                    candidate_section,
                    (
                        "recognized_heading",
                        "specific_section_role",
                        *(('structured_date',) if measured_at else ()),
                        *(('requires_clinical_confirmation',) if review_reasons else ()),
                    ),
                )
            )
    return rows


def _normalized_vital_measurements(
    source_text: str,
) -> tuple[dict[str, Any], list[str]]:
    values: dict[str, list[tuple[float, str | None, str]]] = {}
    unsupported_values: dict[str, list[dict[str, str | None]]] = {}
    review_reasons: list[str] = []

    def add(field: str, raw_number: str, raw_unit: str | None, canonical_value: float) -> None:
        values.setdefault(field, []).append((canonical_value, raw_unit, raw_number))

    bp_pattern = re.compile(
        rf"\b(?:RR|Blutdruck|blood\s+pressure|BD)\s*:?\s*"
        rf"(?P<sys>{VITAL_NUMBER_PATTERN})\s*/\s*(?P<dia>{VITAL_NUMBER_PATTERN})"
        r"\s*(?P<unit>mm\s*Hg|kPa)?(?!\s*[A-Za-z])",
        re.IGNORECASE,
    )
    for match in bp_pattern.finditer(source_text):
        systolic = _parse_localized_number(match.group("sys"))
        diastolic = _parse_localized_number(match.group("dia"))
        if systolic is None or diastolic is None:
            continue
        unit = (match.group("unit") or "").replace(" ", "").casefold()
        if not unit:
            review_reasons.append("ambiguous_unit:blood_pressure")
        elif unit == "kpa":
            systolic *= 7.50062
            diastolic *= 7.50062
        add("bp_systolic", match.group("sys"), match.group("unit"), systolic)
        add("bp_diastolic", match.group("dia"), match.group("unit"), diastolic)

    composite_spans: dict[str, list[tuple[int, int]]] = {}
    composite_patterns: tuple[tuple[str, re.Pattern[str]], ...] = (
        (
            "height_cm",
            re.compile(
                rf"\b(?:Gr[oö](?:ß|ss)e|Groesse|K[oö]rpergr[oö](?:ß|ss)e|height)\b\s*:?\s*"
                rf"(?P<major>{VITAL_NUMBER_PATTERN})\s*(?:ft|feet|foot)\s*"
                rf"(?P<minor>{VITAL_NUMBER_PATTERN})\s*(?:in|inch(?:es)?|Zoll)\b",
                re.IGNORECASE,
            ),
        ),
        (
            "weight_kg",
            re.compile(
                rf"\b(?:Gewicht|weight|Entlassgewicht)\b\s*:?\s*"
                rf"(?P<major>{VITAL_NUMBER_PATTERN})\s*(?:st|stone)\s*"
                rf"(?P<minor>{VITAL_NUMBER_PATTERN})\s*(?:lb|lbs|pounds?)\b",
                re.IGNORECASE,
            ),
        ),
    )
    for field, pattern in composite_patterns:
        for match in pattern.finditer(source_text):
            major = _parse_localized_number(match.group("major"))
            minor = _parse_localized_number(match.group("minor"))
            if major is None or minor is None:
                continue
            if field == "height_cm":
                canonical = major * 30.48 + minor * 2.54
                raw_unit = "ft+in"
                if not 0 <= minor < 12:
                    review_reasons.append("invalid_composite_unit:height_cm")
            else:
                canonical = major * 6.35029318 + minor * 0.45359237
                raw_unit = "st+lb"
                if not 0 <= minor < 14:
                    review_reasons.append("invalid_composite_unit:weight_kg")
            add(
                field,
                f"{match.group('major')} {match.group('minor')}",
                raw_unit,
                canonical,
            )
            composite_spans.setdefault(field, []).append(match.span())

    scalar_patterns: tuple[tuple[str, re.Pattern[str]], ...] = (
        (
            "heart_rate",
            re.compile(
                rf"\b(?:Puls|Herzfrequenz|heart\s+rate|HF|Hf)\b\s*:?\s*"
                rf"(?P<number>{VITAL_NUMBER_PATTERN})\s*(?P<unit>bpm|/\s*min|min-?1|Hz)?(?!\s*[A-Za-z])",
                re.IGNORECASE,
            ),
        ),
        (
            "temperature_c",
            re.compile(
                rf"\b(?:Temperatur|temperature|Temp\.?)\s*:?\s*"
                rf"(?P<number>{VITAL_NUMBER_PATTERN})\s*°?\s*(?P<unit>[CF])?\b(?!\s*[A-Za-z])",
                re.IGNORECASE,
            ),
        ),
        (
            "oxygen_saturation",
            re.compile(
                rf"\b(?:SpO\s*2(?:\s*\([^)]*\))?|Sauerstoffs[aä]ttigung(?:\s*\([^)]*\))?|oxygen\s+saturation)"
                rf"\s*:?\s*(?P<number>{VITAL_NUMBER_PATTERN})\s*(?P<unit>%)?(?!\s*[A-Za-z])",
                re.IGNORECASE,
            ),
        ),
        (
            "respiratory_rate",
            re.compile(
                rf"\b(?:Atemfrequenz|respiratory\s+rate|AF)\b\s*:?\s*"
                rf"(?P<number>{VITAL_NUMBER_PATTERN})\s*(?P<unit>/\s*min|min-?1|rpm)?(?!\s*[A-Za-z])",
                re.IGNORECASE,
            ),
        ),
        (
            "weight_kg",
            re.compile(
                rf"\b(?:Gewicht|weight|Entlassgewicht)\b\s*:?\s*"
                rf"(?P<number>{VITAL_NUMBER_PATTERN})\s*(?P<unit>kg|g|lb(?:s)?|st(?:one)?)\b",
                re.IGNORECASE,
            ),
        ),
        (
            "height_cm",
            re.compile(
                rf"\b(?:Gr[oö](?:ß|ss)e|Groesse|K[oö]rpergr[oö](?:ß|ss)e|height)\b\s*:?\s*"
                rf"(?P<number>{VITAL_NUMBER_PATTERN})\s*(?P<unit>cm|mm|m|in(?:ch)?|Zoll|ft)\b",
                re.IGNORECASE,
            ),
        ),
        (
            "bmi",
            re.compile(
                rf"\bBMI\b\s*:?\s*(?P<number>{VITAL_NUMBER_PATTERN})"
                r"\s*(?P<unit>kg\s*/\s*m(?:2|²))?(?!\s*[A-Za-z])",
                re.IGNORECASE,
            ),
        ),
    )

    for field, pattern in scalar_patterns:
        for match in pattern.finditer(source_text):
            if any(
                not (match.end() <= start or match.start() >= end)
                for start, end in composite_spans.get(field, [])
            ):
                continue
            number = _parse_localized_number(match.group("number"))
            if number is None:
                continue
            raw_unit = match.group("unit")
            unit = (raw_unit or "").replace(" ", "").casefold()
            canonical = number
            if field == "heart_rate":
                if unit == "hz":
                    canonical *= 60.0
                # A value explicitly labelled pulse/heart rate is intrinsically
                # a rate even when the source omits the conventional /min.
            elif field == "temperature_c":
                if not unit:
                    review_reasons.append("ambiguous_unit:temperature_c")
                elif unit == "f":
                    canonical = (canonical - 32.0) * 5.0 / 9.0
            elif field == "weight_kg":
                if unit == "g":
                    canonical /= 1000.0
                elif unit in {"lb", "lbs"}:
                    canonical *= 0.45359237
                elif unit in {"st", "stone"}:
                    canonical *= 6.35029318
            elif field == "height_cm":
                if unit == "m":
                    canonical *= 100.0
                elif unit == "mm":
                    canonical /= 10.0
                elif unit in {"in", "inch", "zoll"}:
                    canonical *= 2.54
                elif unit == "ft":
                    canonical *= 30.48
            add(field, match.group("number"), raw_unit, canonical)

    unsupported_patterns: tuple[tuple[str, re.Pattern[str]], ...] = (
        (
            "blood_pressure",
            re.compile(
                rf"\b(?:RR|Blutdruck|blood\s+pressure|BD)\s*:?\s*"
                rf"(?P<number>{VITAL_NUMBER_PATTERN}\s*/\s*{VITAL_NUMBER_PATTERN})\s*"
                r"(?P<unit>[A-Za-z][A-Za-z0-9/²-]*)",
                re.IGNORECASE,
            ),
        ),
        (
            "heart_rate",
            re.compile(
                rf"\b(?:Puls|Herzfrequenz|heart\s+rate|HF|Hf)\b\s*:?\s*"
                rf"(?P<number>{VITAL_NUMBER_PATTERN})\s*(?P<unit>[A-Za-z][A-Za-z0-9/²-]*)",
                re.IGNORECASE,
            ),
        ),
        (
            "temperature_c",
            re.compile(
                rf"\b(?:Temperatur|temperature|Temp\.?)\s*:?\s*"
                rf"(?P<number>{VITAL_NUMBER_PATTERN})\s*°?\s*(?P<unit>[A-Za-z]+)",
                re.IGNORECASE,
            ),
        ),
        (
            "oxygen_saturation",
            re.compile(
                rf"\b(?:SpO\s*2(?:\s*\([^)]*\))?|Sauerstoffs[aä]ttigung(?:\s*\([^)]*\))?|oxygen\s+saturation)"
                rf"\s*:?\s*(?P<number>{VITAL_NUMBER_PATTERN})\s*(?P<unit>[A-Za-z]+)",
                re.IGNORECASE,
            ),
        ),
        (
            "respiratory_rate",
            re.compile(
                rf"\b(?:Atemfrequenz|respiratory\s+rate|AF)\b\s*:?\s*"
                rf"(?P<number>{VITAL_NUMBER_PATTERN})\s*(?P<unit>[A-Za-z][A-Za-z0-9/²-]*)",
                re.IGNORECASE,
            ),
        ),
        (
            "weight_kg",
            re.compile(
                rf"\b(?:Gewicht|weight|Entlassgewicht)\b\s*:?\s*"
                rf"(?P<number>{VITAL_NUMBER_PATTERN})\s*(?P<unit>[A-Za-z][A-Za-z0-9/²-]*)",
                re.IGNORECASE,
            ),
        ),
        (
            "height_cm",
            re.compile(
                rf"\b(?:Gr[oö](?:ß|ss)e|Groesse|K[oö]rpergr[oö](?:ß|ss)e|height)\b\s*:?\s*"
                rf"(?P<number>{VITAL_NUMBER_PATTERN})\s*(?P<unit>[A-Za-z][A-Za-z0-9/²-]*)",
                re.IGNORECASE,
            ),
        ),
        (
            "bmi",
            re.compile(
                rf"\bBMI\b\s*:?\s*(?P<number>{VITAL_NUMBER_PATTERN})\s*"
                r"(?P<unit>[A-Za-z][A-Za-z0-9/²-]*)",
                re.IGNORECASE,
            ),
        ),
    )
    allowed_units = {
        "blood_pressure": {"mmhg", "kpa"},
        "heart_rate": {"bpm", "min-1", "hz"},
        "temperature_c": {"c", "f"},
        "oxygen_saturation": set(),
        "respiratory_rate": {"min-1", "rpm"},
        "weight_kg": {"kg", "g", "lb", "lbs", "st", "stone"},
        "height_cm": {"cm", "mm", "m", "in", "inch", "zoll", "ft"},
        "bmi": {"kg/m2", "kg/m²"},
    }
    for field, pattern in unsupported_patterns:
        for match in pattern.finditer(source_text):
            raw_unit = match.group("unit")
            compact_unit = raw_unit.replace(" ", "").casefold()
            if compact_unit in allowed_units[field]:
                continue
            review_reasons.append(f"unsupported_unit:{field}")
            unsupported_values.setdefault(field, []).append(
                {"value": match.group("number"), "unit": raw_unit}
            )

    # Unlabeled height/weight pairs are accepted only when both conventional
    # units occur close together, as in physical-examination parentheses.
    dimension_patterns = (
        re.compile(
            rf"(?P<height>{VITAL_NUMBER_PATTERN})\s*(?P<height_unit>cm|m)\b"
            rf"(?:(?!\bBMI\b).){{0,50}}?(?P<weight>{VITAL_NUMBER_PATTERN})\s*(?P<weight_unit>kg)\b",
            re.IGNORECASE,
        ),
        re.compile(
            rf"(?P<weight>{VITAL_NUMBER_PATTERN})\s*(?P<weight_unit>kg)\b"
            rf"(?:(?!\bBMI\b).){{0,50}}?(?P<height>{VITAL_NUMBER_PATTERN})\s*(?P<height_unit>cm|m)\b",
            re.IGNORECASE,
        ),
    )
    if "height_cm" not in values and "weight_kg" not in values:
        for pattern in dimension_patterns:
            for match in pattern.finditer(source_text):
                height = _parse_localized_number(match.group("height"))
                weight = _parse_localized_number(match.group("weight"))
                if height is None or weight is None:
                    continue
                if match.group("height_unit").casefold() == "m":
                    height *= 100.0
                add("height_cm", match.group("height"), match.group("height_unit"), height)
                add("weight_kg", match.group("weight"), match.group("weight_unit"), weight)

    if not values and not unsupported_values:
        return {}, []

    normalized: dict[str, Any] = {"units": {}, "raw_measurements": {}}
    for field, occurrences in values.items():
        normalized["raw_measurements"][field] = [
            {"value": raw_number, "unit": raw_unit}
            for _, raw_unit, raw_number in occurrences
        ]
        distinct: list[float] = []
        for value, _, _ in occurrences:
            if not any(abs(value - existing) <= 0.05 for existing in distinct):
                distinct.append(value)
        if len(distinct) > 1:
            review_reasons.append(f"conflicting_measurements:{field}")
        value = occurrences[0][0]
        lower, upper = VITAL_PLAUSIBLE_RANGES[field]
        if not lower <= value <= upper:
            review_reasons.append(f"implausible_measurement:{field}")
        normalized[field] = _clean_vital_number(value)
        normalized["units"][field] = VITAL_CANONICAL_UNITS[field]
    for field, occurrences in unsupported_values.items():
        normalized["raw_measurements"].setdefault(field, []).extend(occurrences)

    systolic = normalized.get("bp_systolic")
    diastolic = normalized.get("bp_diastolic")
    if (systolic is None) != (diastolic is None):
        review_reasons.append("incomplete_blood_pressure")
    elif systolic is not None and diastolic is not None and systolic <= diastolic:
        review_reasons.append("invalid_blood_pressure_order")

    if all(field in normalized for field in ("bmi", "weight_kg", "height_cm")):
        height_m = float(normalized["height_cm"]) / 100.0
        calculated = float(normalized["weight_kg"]) / (height_m * height_m)
        if abs(float(normalized["bmi"]) - calculated) > 0.5:
            review_reasons.append("bmi_conflict")

    return normalized, list(dict.fromkeys(review_reasons))


def _lab_cells(line: str) -> list[str]:
    if "\t" in line:
        cells = [cell.strip() for cell in line.split("\t")]
        while cells and not cells[0]:
            cells.pop(0)
        while cells and not cells[-1]:
            cells.pop()
        return cells
    return [cell.strip() for cell in re.split(r"\s{2,}", line.strip()) if cell.strip()]


def _lab_reference(value: str) -> tuple[float | None, float | None]:
    compact = value.strip().strip("()[] ")
    range_match = LAB_REFERENCE_RANGE_RE.search(compact)
    if range_match:
        return (
            _parse_localized_number(range_match.group("low")),
            _parse_localized_number(range_match.group("high")),
        )
    limit_match = LAB_REFERENCE_LIMIT_RE.search(compact)
    if not limit_match:
        return None, None
    number = _parse_localized_number(limit_match.group("number"))
    if limit_match.group("comparator").startswith("<"):
        return None, number
    return number, None


def _lab_abnormal_flag(
    result: float | None,
    comparator: str | None,
    reference_low: float | None,
    reference_high: float | None,
    explicit_marker: str | None,
) -> str:
    compact_marker = (explicit_marker or "").replace(" ", "")
    if compact_marker == "(+)" or compact_marker == "↑":
        return "high"
    if compact_marker == "(-)" or compact_marker == "↓":
        return "low"
    if compact_marker:
        return "abnormal"
    if result is None or comparator in {"<", ">", "<=", ">="}:
        return "unknown"
    if reference_low is not None and result < reference_low:
        return "low"
    if reference_high is not None and result > reference_high:
        return "high"
    if reference_low is not None or reference_high is not None:
        return "normal"
    return "unknown"


def _looks_like_lab_unit(value: str) -> bool:
    compact = value.strip().strip("()[] ")
    return bool(
        re.fullmatch(
            r"(?:%|s|sec|fl|fL|pg|pg/Ery|g|mg|ng|µg|μg|ug|"
            r"pmol|µmol|μmol|mmol|mol|U|IU|I\.E\.|G|T|"
            r"(?:Mio\.|Tsd\.)?/(?:nl|nL|pl|pL|ul|µl|μl)|"
            r"ml/min(?:/1[.,]73m2)?|"
            r"(?:AU|m?IU|m?IE|g|mg|ng|µg|μg|ug|pmol|µmol|μmol|mmol|mol|"
            r"U|IU|[uµμ]UI|µIU|μIU|G|T)/(?:l|L|I|dl|ml))",
            compact,
            re.IGNORECASE,
        )
    )


def _looks_like_lab_sidebar_noise(value: str) -> bool:
    lowered = value.casefold().strip()
    return bool(
        "@" in lowered
        or re.search(r"\b(?:dr\.|facharzt|fachärzt|klinik|telefon|sekretariat)\b", lowered)
        or re.search(r"\b(?:t|f)\s*\d{3,}[/-]", lowered)
    )


LAB_PANEL_HEADING_RE = re.compile(
    r"^(?:kleines\s+|gro(?:ß|ss)es\s+)?blutbild$|"
    r"^(?:differential\s+blutbild\s+(?:absolut|relativ)|diabetologie|"
    r"eiwei(?:ß|ss)[-\s]+elektrophorese|vitamine|"
    r"hämatologie|klinische\s+chemie|enzyme|leberwerte|nierenfunktion|"
    r"gerinnung|immunsystem|immunologie|impftiter|serologie|infektionsserologie|"
    r"sonstiges|stoffwechsel|wasser\s*[-/](?:\s*[-/])?\s*elektrolythaushalt|elektrolyte|"
    r"lipid(?:e|status)|schilddrüse|entzündung)$",
    re.IGNORECASE,
)

LAB_ROW_LEADING_ARTIFACT_RE = re.compile(
    r"^(?:[/\\|!√✓☑•.,:'`]|[NV]){1,3}$",
    re.IGNORECASE,
)


def _looks_like_lab_panel_heading(value: str) -> bool:
    return bool(LAB_PANEL_HEADING_RE.fullmatch(value.strip().rstrip(":")))


def _lab_row_metadata(
    prefix: str,
    metadata_headers: list[str],
) -> tuple[str, str | None, str | None] | None:
    cells = _lab_cells(prefix)
    # Handwritten ticks in the margin are sometimes detected as their own
    # table cell (for example ``/\tAP...``, ``√\tFT3...`` or
    # ``N\tKreatinin...``). They are evidence attached to the row, not the
    # analyte name. Drop only a short, known marker when a real textual cell
    # and an explicit reference value follow it.
    while (
        len(cells) >= 3
        and LAB_ROW_LEADING_ARTIFACT_RE.fullmatch(cells[0])
        and len(re.sub(r"[^A-Za-zÀ-ÖØ-öø-ÿ]", "", cells[1])) >= 2
        and (
            LAB_REFERENCE_RANGE_RE.search(" ".join(cells[2:]))
            or LAB_REFERENCE_LIMIT_RE.search(" ".join(cells[2:]))
        )
    ):
        cells.pop(0)
    if len(cells) == 1:
        inline_matches = list(LAB_REFERENCE_RANGE_RE.finditer(cells[0]))
        inline_matches.extend(LAB_REFERENCE_LIMIT_RE.finditer(cells[0]))
        if not inline_matches:
            return None
        reference_match = max(inline_matches, key=lambda match: match.start())
        analyte = cells[0][: reference_match.start()].strip(" -*•|\\/‘’\"“”?,")
        reference_text = cells[0][reference_match.start() :].strip()
        if not analyte or not any(character.isalpha() for character in analyte):
            return None
        cells = [analyte, reference_text]
    if len(cells) < 2:
        return None
    analyte = cells[0].strip(" -*•")
    unit: str | None = None
    reference_text: str | None = None
    for index, cell in enumerate(cells[1:], start=1):
        header = _heading_key(metadata_headers[index]) if index < len(metadata_headers) else ""
        if header in {"einheit", "unit"}:
            unit = cell
        elif header in {"norm", "referenz", "referenzbereich", "reference"}:
            reference_text = cell
    if reference_text is None:
        reference_text = cells[-1]

    parenthetical_unit = re.search(r"\s*\((?P<unit>[^()]{1,24})\)\s*$", analyte)
    if parenthetical_unit and _looks_like_lab_unit(parenthetical_unit.group("unit")):
        unit = unit or parenthetical_unit.group("unit")
        analyte = analyte[: parenthetical_unit.start()].strip()

    if reference_text and _looks_like_lab_unit(reference_text):
        unit = unit or reference_text
        reference_text = None

    reference_match = (
        LAB_REFERENCE_RANGE_RE.search(reference_text)
        or LAB_REFERENCE_LIMIT_RE.search(reference_text)
        if reference_text
        else None
    )
    if reference_match:
        trailing = reference_text[reference_match.end() :].strip()
        trailing_unit = trailing.strip("()[] ")
        if trailing_unit and _looks_like_lab_unit(trailing_unit):
            unit = unit or trailing_unit
            reference_text = reference_text[: reference_match.end()].strip()
    if not analyte or len(analyte) > 160 or not any(character.isalpha() for character in analyte):
        return None
    return analyte, unit, reference_text or None


def _repair_split_laboratory_result_rows(page: str) -> str:
    """Join a result detected one line before its ruled-table metadata.

    Dense scans can put the value box a few pixels above the analyte baseline.
    Paddle then emits ``170.32`` followed by ``Ferritin\t68 - 434 (ng/ml)``.
    The relationship is unambiguous only when the second line contains a
    structured reference value, so narrative numbers remain untouched.
    """

    lines = page.splitlines()
    repaired: list[str] = []
    index = 0
    while index < len(lines):
        current = lines[index].strip()
        if LAB_RESULT_RE.fullmatch(current) and index + 1 < len(lines):
            following = lines[index + 1].strip()
            following_cells = _lab_cells(following)
            has_trailing_result = any(
                LAB_RESULT_RE.fullmatch(cell) or LAB_TEXT_RESULT_RE.fullmatch(cell)
                for cell in following_cells[1:]
            )
            if (
                len(following_cells) >= 2
                and not has_trailing_result
                and _lab_row_metadata(
                    following,
                    ["Testbezeichnung", "Normwert"],
                )
                is not None
            ):
                repaired.append(f"{following}\t{current}")
                index += 2
                continue
        repaired.append(lines[index])
        index += 1
    return "\n".join(repaired)


def _looks_like_dated_normwert_body(page: str) -> bool:
    """Recognize a dense Normwert table even when OCR misses its header."""

    structured_rows = 0
    for raw_line in page.splitlines():
        cells = _lab_cells(raw_line)
        if len(cells) < 3:
            continue
        result_index = next(
            (
                index
                for index, cell in enumerate(cells[1:], start=1)
                if LAB_RESULT_RE.fullmatch(cell) or LAB_TEXT_RESULT_RE.fullmatch(cell)
            ),
            None,
        )
        if result_index is None:
            continue
        if _lab_row_metadata(
            "\t".join(cells[:result_index]),
            ["Testbezeichnung", "Normwert"],
        ) is None:
            continue
        structured_rows += 1
        if structured_rows >= 3:
            return True
    return False


def _trailing_lab_result_cells(
    raw_line: str,
    minimum_metadata_cells: int = 2,
) -> tuple[list[str], list[str]]:
    """Separate metadata from the trailing result cells of a table row."""

    cells = _lab_cells(raw_line)
    results: list[str] = []
    while len(cells) > minimum_metadata_cells and (
        LAB_RESULT_RE.fullmatch(cells[-1]) or LAB_TEXT_RESULT_RE.fullmatch(cells[-1])
    ):
        results.append(cells.pop())
    results.reverse()
    return cells, results


def _lab_result_starts(raw_line: str, results: list[str]) -> list[int]:
    """Return result-cell starts without matching identical reference values."""

    starts: list[int] = []
    cursor = len(raw_line)
    for result in reversed(results):
        start = raw_line.rfind(result, 0, cursor)
        if start < 0:
            return []
        starts.append(start)
        cursor = start
    starts.reverse()
    return starts


def _continuation_lab_column_positions(
    page: str,
    column_count: int,
    metadata_column_count: int,
) -> list[int]:
    """Infer shifted date columns when a longitudinal table continues on a new page."""

    best: list[int] = []
    for raw_line in page.splitlines():
        heading_key = _heading_key(raw_line.strip().rstrip(":"))
        if heading_key in {"wichtigerhinweis", "hinweis"}:
            break
        _, results = _trailing_lab_result_cells(raw_line, metadata_column_count)
        if len(results) <= len(best) or len(results) > column_count:
            continue
        starts = _lab_result_starts(raw_line, results)
        if starts:
            best = starts
        if len(best) == column_count:
            break
    return best if len(best) == column_count else []


def _lab_candidate(
    *,
    analyte: str,
    result_text: str,
    unit: str | None,
    reference_text: str | None,
    measured_on: str | None,
    panel: str,
    page_number: int,
    source_text: str,
    review_reasons: tuple[str, ...] = (),
) -> ClinicalCandidate:
    result_match = LAB_RESULT_RE.fullmatch(result_text)
    numeric_result = _parse_localized_number(result_match.group("number")) if result_match else None
    comparator = result_match.group("comparator") if result_match else None
    explicit_marker = result_match.group("marker") if result_match else ""
    reference_low, reference_high = _lab_reference(reference_text or "")
    abnormal_flag = _lab_abnormal_flag(
        numeric_result,
        comparator,
        reference_low,
        reference_high,
        explicit_marker,
    )
    if numeric_result is None and reference_text:
        textual_result = result_text.casefold().strip(" .()")
        textual_reference = reference_text.casefold().strip(" .()")
        negative_terms = {"neg", "negativ", "nicht nachweisbar"}
        positive_terms = {"pos", "positiv", "reaktiv", "nachweisbar"}
        normal_terms = {"normal", "unauffällig"}
        if (
            (textual_result in negative_terms and textual_reference in negative_terms)
            or (textual_result in positive_terms and textual_reference in positive_terms)
            or (textual_result in normal_terms and textual_reference in normal_terms)
        ):
            abnormal_flag = "normal"
        elif textual_reference in negative_terms and textual_result in positive_terms:
            abnormal_flag = "abnormal"
    value = f"{analyte}: {result_text}"
    if unit:
        value += f" {unit}"
    if reference_text:
        value += f" (Referenz: {reference_text})"
    section = Section(
        target="lab_result",
        heading=panel,
        text=source_text.strip(),
        page=page_number,
    )
    reasons = list(review_reasons)
    if measured_on is None:
        reasons.append("laboratory_date_requires_confirmation")
    return _candidate(
        "lab_result",
        value,
        {
            "panel": panel,
            "analyte_name": analyte,
            "result_text": result_text,
            "numeric_result": numeric_result,
            "comparator": comparator,
            "unit": unit,
            "reference_text": reference_text,
            "reference_low": reference_low,
            "reference_high": reference_high,
            "abnormal_flag": abnormal_flag,
            "measured_on": measured_on,
            "auto_select": measured_on is not None and not reasons,
            "review_reasons": reasons,
            "semantic_role": "laboratory_observation",
        },
        section,
        ("specific_section_role", "structured_date") if measured_on else ("specific_section_role",),
    )


def _narrative_laboratory_candidates(
    text: str,
    *,
    admission_date: str | None,
    discharge_date: str | None,
) -> list[ClinicalCandidate]:
    candidates: list[ClinicalCandidate] = []
    boundary = re.compile(
        r"^(?:EKG|Mikrobiologische|Blutkultur|R[oö]ntgen|Histologie|Beurteilung|"
        r"Therapie|Medikation|Weiteres\s+Prozedere)\b",
        re.IGNORECASE,
    )
    for page_number, page in enumerate(text.split("\f"), start=1):
        lines = page.splitlines()
        index = 0
        while index < len(lines):
            line = lines[index].strip()
            context_match = re.match(
                r"^Laborwerte\s+bei\s+(?P<context>Aufnahme|Entlassung)\s*:\s*(?P<body>.*)$",
                line,
                re.IGNORECASE,
            )
            if not context_match:
                index += 1
                continue
            context = context_match.group("context").casefold()
            measured_on = admission_date if context == "aufnahme" else discharge_date
            block = [context_match.group("body")]
            cursor = index + 1
            while cursor < len(lines):
                following = lines[cursor].strip()
                if not following or boundary.match(following):
                    break
                block.append(following)
                cursor += 1
            source_text = " ".join(part for part in block if part).strip()
            for match in LAB_NARRATIVE_VALUE_RE.finditer(source_text):
                analyte = re.sub(r"\s*\(Hb\)\s*$", "", match.group("analyte"), flags=re.IGNORECASE)
                result_text = f"{match.group('comparator') or ''}{match.group('number')}"
                candidates.append(
                    _lab_candidate(
                        analyte=analyte,
                        result_text=result_text,
                        unit=match.group("unit"),
                        reference_text=None,
                        measured_on=measured_on,
                        panel=f"Laborwerte bei {context_match.group('context')}",
                        page_number=page_number,
                        source_text=source_text,
                    )
                )
            index = max(cursor, index + 1)
    return candidates


def _single_result_laboratory_candidates(text: str) -> list[ClinicalCandidate]:
    """Parse vertical one-result-per-row laboratory tables.

    This is deliberately separate from the date-column parser: a table headed
    ``Parameter / Ergebnis / Einheit / Referenzbereich`` has different column
    semantics from longitudinal tables whose result columns are dates.
    """

    measured_on = _laboratory_date(text)
    candidates: list[ClinicalCandidate] = []
    current_panel = "Labor"
    laboratory_mode = False
    laboratory_table = False

    for page_number, page in enumerate(text.split("\f"), start=1):
        for raw_line in page.splitlines():
            line = raw_line.strip()
            cells = _lab_cells(raw_line)
            if not line:
                continue
            heading_key = _heading_key(line.rstrip(":"))
            if heading_key.startswith(
                (
                    "medikation",
                    "aktuellemedikation",
                    "dauermedikation",
                    "entlassungsmedikation",
                    "medikationbeientlassung",
                    "empfohlenemedikation",
                    "häuslichemedikation",
                    "medikamente",
                    "medikationsplan",
                    "bundeseinheitlichermedikationsplan",
                )
            ):
                laboratory_mode = False
                laboratory_table = False
                continue
            if heading_key.startswith("labor"):
                laboratory_mode = True
                current_panel = line.rstrip(":")
                continue
            lowered = " ".join(cells).casefold()
            if LAB_COLUMN_DATE_RE.search(raw_line) and "ergebnis" not in lowered:
                laboratory_table = False
                continue
            if _medication_table_headers(raw_line):
                laboratory_mode = False
                laboratory_table = False
                continue
            if (
                ("referenzbereich" in lowered or "normbereich" in lowered)
                and ("ergebnis" in lowered or re.search(r"\bwert\b", lowered))
            ) or (
                cells
                and _heading_key(cells[0])
                in {"parameter", "messwert", "analyt", "untersuchung", "bezeichnung"}
            ):
                laboratory_mode = True
                laboratory_table = True
                continue
            if len(cells) == 1:
                if laboratory_mode and _looks_like_lab_panel_heading(line):
                    current_panel = line.rstrip(":")
                continue
            if not laboratory_table:
                continue

            result_index = next(
                (
                    index
                    for index, cell in enumerate(cells[1:], start=1)
                    if LAB_RESULT_RE.fullmatch(cell.strip())
                    or LAB_TEXT_RESULT_RE.fullmatch(cell.strip())
                ),
                None,
            )
            if result_index is None:
                if laboratory_mode and cells and _looks_like_lab_panel_heading(cells[0]):
                    current_panel = cells[0].rstrip(":")
                continue
            analyte = " ".join(cells[:result_index]).strip(" -*•")
            if not analyte or len(analyte) > 160 or not any(char.isalpha() for char in analyte):
                continue
            result_text = cells[result_index].strip()
            trailing = cells[result_index + 1 :]
            reference_index = next(
                (
                    index
                    for index, cell in enumerate(trailing)
                    if LAB_REFERENCE_RANGE_RE.search(cell)
                    or LAB_REFERENCE_LIMIT_RE.search(cell)
                    or LAB_TEXT_RESULT_RE.fullmatch(cell)
                ),
                None,
            )
            unit_cells = trailing[:reference_index] if reference_index is not None else trailing
            unit = next((cell.strip() for cell in unit_cells if _looks_like_lab_unit(cell)), "")
            unit_requires_review = bool(
                not unit
                and any(
                    cell.strip() and not _looks_like_lab_sidebar_noise(cell)
                    for cell in unit_cells
                )
            )
            # OCR often places unrelated sidebar/footer text in later table
            # cells. Keep only the cell that actually contains the reference.
            reference_text = trailing[reference_index].strip() if reference_index is not None else ""
            candidates.append(
                _lab_candidate(
                    analyte=analyte,
                    result_text=result_text,
                    unit=unit or None,
                    reference_text=reference_text or None,
                    measured_on=measured_on,
                    panel=current_panel,
                    page_number=page_number,
                    source_text=line,
                    review_reasons=("laboratory_unit_requires_confirmation",)
                    if unit_requires_review
                    else (),
                )
            )
    return candidates


def _laboratory_candidates(
    text: str,
    *,
    admission_date: str | None = None,
    discharge_date: str | None = None,
    laboratory_name: str | None = None,
) -> list[ClinicalCandidate]:
    """Extract one candidate per analyte/date from layout-aware laboratory tables."""

    candidates = _narrative_laboratory_candidates(
        text,
        admission_date=admission_date,
        discharge_date=discharge_date,
    )
    candidates.extend(_single_result_laboratory_candidates(text))
    current_panel = "Labor"
    laboratory_mode = False
    column_dates: list[str] = []
    column_positions: list[int] = []
    metadata_headers: list[str] = []
    medication_heading_prefixes = (
        "medikation",
        "aktuellemedikation",
        "dauermedikation",
        "entlassungsmedikation",
        "medikationbeientlassung",
        "empfohlenemedikation",
        "häuslichemedikation",
        "medikamente",
        "medikationsplan",
        "bundeseinheitlichermedikationsplan",
    )

    pages = text.split("\f")
    document_table_date = next(
        (
            date
            for page in pages
            if (date := _dated_normwert_table_date(page)) is not None
        ),
        None,
    )

    for page_number, original_page in enumerate(pages, start=1):
        page = _repair_split_laboratory_result_rows(original_page)
        split_header_date = _dated_normwert_table_date(page)
        inherited_header_date = (
            document_table_date
            if split_header_date is None and _looks_like_dated_normwert_body(page)
            else None
        )
        table_date = split_header_date or inherited_header_date
        if table_date:
            laboratory_mode = True
            column_dates = [table_date]
            # The single-result parser below consumes OCR cells rather than
            # absolute positions; a sentinel keeps the shared table state on.
            column_positions = [0]
            metadata_headers = ["Testbezeichnung", "Normwert"]
        continued_table = laboratory_mode and bool(column_dates)
        continuation_positions = (
            _continuation_lab_column_positions(
                page,
                len(column_dates),
                max(2, len(metadata_headers)),
            )
            if continued_table
            else []
        )
        for line_index, raw_line in enumerate(page.splitlines()):
            line = raw_line.strip()
            if not line:
                continue
            heading_key = _heading_key(line.rstrip(":"))
            if heading_key.startswith(medication_heading_prefixes):
                laboratory_mode = False
                column_dates = []
                column_positions = []
                metadata_headers = []
                continue
            if heading_key in {"wichtigerhinweis", "hinweis"}:
                laboratory_mode = False
                column_dates = []
                column_positions = []
                metadata_headers = []
                continue
            if heading_key.startswith("labor"):
                laboratory_mode = True
                current_panel = line.rstrip(":")
                continue

            date_matches = list(LAB_COLUMN_DATE_RE.finditer(raw_line))
            header_cells = _lab_cells(raw_line)
            header_keys = [_heading_key(cell) for cell in header_cells]
            if split_header_date and line_index < 10 and (
                date_matches
                or any(
                    key
                    in {
                        "testbezeichnung",
                        "bezeichnung",
                        "parameter",
                        "messwert",
                        "analyt",
                        "normwert",
                        "normbereich",
                        "referenzbereich",
                    }
                    for key in header_keys
                )
            ):
                continue
            if heading_key.startswith(("ausdru", "seite")):
                continue
            is_dated_normwert_header = bool(
                date_matches
                and header_keys
                and header_keys[0]
                in {"testbezeichnung", "bezeichnung", "parameter", "messwert", "analyt"}
                and any(
                    key in {"norm", "normwert", "referenz", "referenzbereich", "reference"}
                    for key in header_keys[1:]
                )
            )
            if is_dated_normwert_header:
                laboratory_mode = True
            if laboratory_mode and _looks_like_lab_panel_heading(line):
                current_panel = line.rstrip(":")
                continue
            if laboratory_mode and date_matches:
                normalized_dates = [
                    _normalize_german_date(match.group("date")) for match in date_matches
                ]
                if all(normalized_dates):
                    column_dates = [date for date in normalized_dates if date is not None]
                    column_positions = [match.start() for match in date_matches]
                    metadata_headers = _lab_cells(raw_line[: column_positions[0]])
                    continue
            if not laboratory_mode or not column_dates or not column_positions:
                continue

            if len(column_dates) == 1:
                cells = _lab_cells(raw_line)
                for result_index, result_cell in enumerate(cells[1:], start=1):
                    result_text = result_cell.strip(" |[]{}")
                    if not (
                        LAB_RESULT_RE.fullmatch(result_text)
                        or LAB_TEXT_RESULT_RE.fullmatch(result_text)
                    ):
                        continue
                    metadata = _lab_row_metadata(
                        "\t".join(cells[:result_index]), metadata_headers
                    )
                    if metadata is None:
                        continue
                    analyte, unit, reference_text = metadata
                    candidates.append(
                        _lab_candidate(
                            analyte=analyte,
                            result_text=result_text,
                            unit=unit,
                            reference_text=reference_text,
                            measured_on=column_dates[0],
                            panel=current_panel,
                            page_number=page_number,
                            source_text=line,
                        )
                    )
                    break
                else:
                    result_index = None
                if result_index is not None:
                    continue

            if continued_table:
                metadata_cells, result_cells = _trailing_lab_result_cells(
                    raw_line,
                    max(2, len(metadata_headers)),
                )
                metadata = _lab_row_metadata("\t".join(metadata_cells), metadata_headers)
                result_starts = _lab_result_starts(raw_line, result_cells)
                if metadata is not None and result_cells and result_starts:
                    analyte, unit, reference_text = metadata
                    if continuation_positions:
                        date_indexes = [
                            min(
                                range(len(continuation_positions)),
                                key=lambda index: abs(continuation_positions[index] - start),
                            )
                            for start in result_starts
                        ]
                    else:
                        date_indexes = list(range(len(result_cells)))
                    if len(set(date_indexes)) == len(date_indexes) and all(
                        index < len(column_dates) for index in date_indexes
                    ):
                        for result_text, date_index in zip(
                            result_cells, date_indexes, strict=True
                        ):
                            candidates.append(
                                _lab_candidate(
                                    analyte=analyte,
                                    result_text=result_text,
                                    unit=unit,
                                    reference_text=reference_text,
                                    measured_on=column_dates[date_index],
                                    panel=current_panel,
                                    page_number=page_number,
                                    source_text=line,
                                )
                            )
                        continue

            metadata = _lab_row_metadata(raw_line[: column_positions[0]], metadata_headers)
            if metadata is None:
                continue
            analyte, unit, reference_text = metadata
            for column_index, (measured_on, start) in enumerate(
                zip(column_dates, column_positions, strict=True)
            ):
                end = (
                    column_positions[column_index + 1]
                    if column_index + 1 < len(column_positions)
                    else len(raw_line)
                )
                result_text = raw_line[start:end].strip()
                if not result_text or not (
                    LAB_RESULT_RE.fullmatch(result_text)
                    or LAB_TEXT_RESULT_RE.fullmatch(result_text)
                ):
                    continue
                candidates.append(
                    _lab_candidate(
                        analyte=analyte,
                        result_text=result_text,
                        unit=unit,
                        reference_text=reference_text,
                        measured_on=measured_on,
                        panel=current_panel,
                        page_number=page_number,
                        source_text=line,
                    )
                )
    for candidate in candidates:
        candidate.normalized["laboratory_name"] = laboratory_name
    return candidates


def _detect_language(text: str) -> str | None:
    lowered = f" {text.lower()} "
    scores = {
        "de": sum(lowered.count(token) for token in (" der ", " die ", " und ", " keine ", " befund ")),
        "ru": sum(lowered.count(token) for token in (" и ", " диагноз", " анамнез", " пациент")),
        "uk": sum(lowered.count(token) for token in (" та ", " діагноз", " анамнез", " пацієнт")),
        "en": sum(lowered.count(token) for token in (" the ", " and ", " diagnosis", " patient")),
    }
    language, score = max(scores.items(), key=lambda item: item[1])
    return language if score else None


def _detect_document_type(text: str) -> str:
    lowered = text.casefold()

    # These section combinations are substantially more specific than individual
    # modality words such as CT, which often also appear in oncology letters.
    if any(
        marker in lowered
        for marker in (
            "unverbindliche voraussichtliche kostenschätzung",
            "orientierungsangebot für medizinische leistungen",
            "ориентировочный расчёт стоимости медицинских услуг",
        )
    ):
        return "administrative_cost_estimate"
    if re.search(
        r"(?:Bezeichnung|Parameter|Messwert)[^\n\f]*(?:Wert|Ergebnis)"
        r"[^\n\f]*Einheit[^\n\f]*(?:Normbereich|Referenzbereich)",
        text,
        re.IGNORECASE,
    ):
        return "laboratory_report"
    if re.search(
        r"(?:Testbezeichnung|Bezeichnung|Parameter|Messwert)[^\n\f]*"
        r"(?:Normwert|Normbereich|Referenzbereich)[^\n\f]*"
        r"\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4})",
        text,
        re.IGNORECASE,
    ):
        return "laboratory_report"
    if any(_dated_normwert_table_date(page) for page in text.split("\f")):
        return "laboratory_report"
    if "onkologische diagnosen" in lowered or "nichtonkologische diagnosen" in lowered:
        return "oncology_report"
    if "kardiologie" in lowered and any(
        marker in lowered for marker in ("vorhofflimmern", "echokardiographie", "kardioversion")
    ):
        return "cardiology_report"
    if (
        "entlassungsbrief" in lowered
        or "entlassbrief" in lowered
        or re.search(r"\bstation[aä]r\w*\s+behandlung\b", lowered)
    ) and "diagnos" in lowered:
        return "discharge_summary"
    radiology_headings = sum(
        bool(re.search(pattern, lowered, re.MULTILINE))
        for pattern in (
            r"^\s*klinische angaben\s*:?\s*$",
            r"^\s*befund\s*:?\s*$",
            r"^\s*beurteilung\s*:?\s*$",
        )
    )
    if radiology_headings >= 2:
        return "radiology_report"

    hints: dict[str, list[str]] = load_rules().get("document_type_hints", {})
    scored = {
        document_type: sum(1 for hint in document_hints if hint.casefold() in lowered)
        for document_type, document_hints in hints.items()
    }
    if not scored:
        return "medical_report"
    best, score = max(scored.items(), key=lambda item: item[1])
    return best if score else "medical_report"


def _alias_map() -> dict[str, Target]:
    mapping: dict[str, Target] = {}
    for target, aliases in load_rules().get("section_aliases", {}).items():
        if target not in SUPPORTED_TARGETS:
            continue
        for alias in aliases:
            mapping[_heading_key(alias)] = target  # type: ignore[assignment]
    return mapping


def _heading_key(value: str) -> str:
    return re.sub(r"[^\wäöüßа-яіїєґ]+", "", value.casefold(), flags=re.UNICODE)


def _bounded_edit_distance(left: str, right: str, limit: int) -> int:
    if abs(len(left) - len(right)) > limit:
        return limit + 1
    previous = list(range(len(right) + 1))
    for left_index, left_character in enumerate(left, start=1):
        current = [left_index]
        row_minimum = left_index
        for right_index, right_character in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_character != right_character),
                )
            )
            row_minimum = min(row_minimum, current[-1])
        if row_minimum > limit:
            return limit + 1
        previous = current
    return previous[-1]


def _match_fuzzy_heading(
    stripped: str,
    aliases: dict[str, Target],
) -> tuple[Target, str, str] | None:
    prefix, separator, remainder = stripped.partition(":")
    candidate = prefix.strip() if separator else stripped.rstrip(":").strip()
    candidate_key = _heading_key(candidate)
    if not 6 <= len(candidate_key) <= 80:
        return None
    limit = 1 if len(candidate_key) <= 12 else 2 if len(candidate_key) <= 30 else 3
    best: tuple[int, str, Target] | None = None
    for alias_key, target in aliases.items():
        if not alias_key or alias_key[0] != candidate_key[0]:
            continue
        distance = _bounded_edit_distance(candidate_key, alias_key, limit)
        if distance <= limit and (best is None or distance < best[0]):
            best = (distance, alias_key, target)
    if best is None:
        return None
    return best[2], candidate, remainder.strip() if separator else ""


def _match_heading(line: str, aliases: dict[str, Target]) -> tuple[Target, str, str] | None:
    stripped = line.strip()
    if not stripped or len(stripped) > 240:
        return None

    without_colon = stripped.rstrip(":").strip()
    target = aliases.get(_heading_key(without_colon))
    if target:
        return target, without_colon, ""

    if ":" in stripped:
        prefix, remainder = stripped.split(":", 1)
        target = aliases.get(_heading_key(prefix))
        if target:
            return target, prefix.strip(), remainder.strip()

    dated_heading = re.match(
        r"^(?P<heading>.+?)\s+(?:vom|am)\s+"
        r"(?P<date>\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2}))(?!\d)\s*:?[ \t]*"
        r"(?P<remainder>.*)$",
        stripped,
        re.IGNORECASE,
    )
    if dated_heading:
        target = aliases.get(_heading_key(dated_heading.group("heading")))
        if target:
            return (
                target,
                f"{dated_heading.group('heading').strip()} vom {dated_heading.group('date')}",
                dated_heading.group("remainder").strip(),
            )

    medication_dated = re.match(
        r"^(?P<heading>(?:(?:Aktuelle|Dauer|Entlassungs|H[aä]usliche)\s+)?"
        r"(?:Medikation|Medikationsplan|Medikamente)|Bundeseinheitlicher\s+Medikationsplan)"
        r"\s+(?P<date_label>(?:vom|am)\s+\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2}))"
        r"\s*:?[ \t]*(?P<remainder>.*)$",
        stripped,
        re.IGNORECASE,
    )
    if medication_dated:
        heading_text = f"{medication_dated.group('heading')} {medication_dated.group('date_label')}"
        return "medication", heading_text, medication_dated.group("remainder").strip()

    fuzzy = _match_fuzzy_heading(stripped, aliases)
    if fuzzy:
        return fuzzy

    laboratory = re.match(
        r"^(?P<heading>Labor(?:befund)?\s+vom)(?:\s+[^A-Za-zÄÖÜäöüß]{0,100}(?:\d{2,4})?)?\s*:?[ \t]*(?P<remainder>.*)$",
        stripped,
        re.IGNORECASE,
    )
    if laboratory:
        return "examination", laboratory.group("heading"), laboratory.group("remainder").strip()
    return None


def _match_contextual_ocr_heading(
    line: str,
    current: Section | None,
    lines: list[str],
    line_index: int,
) -> tuple[Target, str, str] | None:
    """Recover a short heading only when the surrounding text makes it unambiguous.

    Scanned letters with a redaction immediately below ``Anamnese`` can make
    Tesseract return only ``Ana``. ``ANA`` is also a legitimate laboratory
    abbreviation, so the short token must never be a global section alias.
    """

    if _heading_key(line) not in {"ana", "anamn", "anamnes"}:
        return None
    if current is None or current.target != "diagnosis":
        return None

    next_line = next(
        (candidate.strip() for candidate in lines[line_index + 1 :] if candidate.strip()),
        "",
    )
    lowered = next_line.casefold()
    narrative_markers = (
        "herr ",
        "frau ",
        "patient",
        "patientin",
        "stellt sich",
        "beschwerden",
        "anamnestisch",
        "vorgeschichte",
    )
    if len(next_line) < 30 or not any(marker in lowered for marker in narrative_markers):
        return None
    return "anamnesis", "Anamnese", ""


def _split_sections(text: str) -> list[Section]:
    aliases = _alias_map()
    pages = text.split("\f")
    sections: list[Section] = []
    current: Section | None = None

    for page_number, page in enumerate(pages, start=1):
        lines = page.splitlines()
        skip_rest_of_page = False
        for line_index, raw_line in enumerate(lines):
            line = raw_line.strip()
            if not line:
                continue
            if skip_rest_of_page:
                continue
            if _is_signoff_line(line):
                skip_rest_of_page = True
                continue
            if _is_repeated_page_noise(line, line_index, len(lines)):
                continue

            heading = _match_heading(line, aliases)
            if heading is None:
                heading = _match_contextual_ocr_heading(line, current, lines, line_index)
            if heading:
                if current and _section_role(current.heading) == "chronology" and heading[2]:
                    # Reports often embed labels such as ``Diagnosen: ...`` or
                    # ``Beurteilung: ...`` inside a dated chronology event. An
                    # inline label is content, not a new top-level section.
                    _append_section_line(current, line, page_number)
                    continue
                if current and current.text.strip():
                    sections.append(current)
                target, heading_text, remainder = heading
                current = Section(target=target, heading=heading_text, text="", page=page_number)
                if remainder:
                    _append_section_line(current, remainder, page_number)
                continue

            if current:
                _append_section_line(current, line, page_number)

    if current and current.text.strip():
        sections.append(current)
    return sections


def _append_section_line(section: Section, line: str, page: int) -> None:
    section.text = f"{section.text}\n{line}".strip()
    section.line_pages.append(page)


def _is_repeated_page_noise(line: str, line_index: int, line_count: int) -> bool:
    normalized = " ".join(line.casefold().split())
    if line_index <= 2 and re.fullmatch(r"(?:seite\s*)?\d+(?:\s*(?:/|von)\s*\d+)?", normalized):
        return True
    if re.fullmatch(r"(?:seite|page)\s+\d+(?:\s*(?:/|von|of)\s*\d+)?", normalized):
        return True
    if any(
        token in normalized
        for token in (
            "registergericht",
            "iban ",
            "bic ",
        )
    ):
        return True
    if line_index <= 4 and (
        normalized == "privatpraxis"
        or normalized.startswith("facharzt für ")
        or normalized.startswith("sportmedizin - notfallmedizin")
        or re.fullmatch(r"dr\.\s*med\.\s+[\wäöüß .'-]+", normalized)
    ):
        return True
    if (line_index <= 4 or line_index >= max(0, line_count - 4)) and any(
        token in normalized
        for token in (
            "münchner onkologie",
            "onkologische schwerpunktpraxis",
        )
    ):
        return True
    return False


def _is_signoff_line(line: str) -> bool:
    if _heading_key(line.rstrip(":")) == "wichtigerhinweis":
        return True
    return bool(
        re.match(
            r"^(?:mit\s+)?(?:freundliche[nr]?\s+)?(?:kollegiale[nr]?\s+)?(?:grüße|grüsse|grüßen|grüssen)|^hochachtungsvoll",
            line.strip(),
            re.IGNORECASE,
        )
    )


def _section_role(heading: str) -> str:
    key = _heading_key(heading)
    if key in {
        "klinischeangaben",
        "indikation",
        "fragestellung",
        "vorstellungsgrund",
        "untersuchungsanlass",
    }:
        return "indication"
    if key == "familienanamnese":
        return "family_history"
    if key in {"eigenanamnese", "vorgeschichte"}:
        return "personal_history"
    if key == "sozialanamnese":
        return "social_history"
    if key == "befund":
        return "finding"
    if key == "beurteilung":
        return "impression"
    if key.startswith("zusammenfassendebeurteilun"):
        return "assessment"
    if key.startswith("chronologie"):
        return "chronology"
    if key.startswith("labor"):
        return "laboratory"
    if key in {"körpermaße", "körpermasse", "koerpermasse", "karnofskyindex"}:
        return "measurement"
    if key == "aktuell":
        return "current"
    return "section"


def _candidate(
    target: Target,
    value: str,
    normalized: dict[str, Any],
    section: Section,
    confidence_signals: tuple[str, ...] = (),
) -> ClinicalCandidate:
    normalized = dict(normalized)
    confidence, basis = _confidence_from_evidence(value, confidence_signals)
    normalized["confidence_kind"] = "semantic_classification"
    normalized["confidence_basis"] = basis
    auto_select = normalized.get("auto_select", True)
    return ClinicalCandidate(
        id=str(uuid.uuid4()),
        target=target,
        value=value.strip(),
        normalized=normalized,
        confidence=confidence,
        selected=bool(auto_select),
        source=SourceEvidence(page=section.page, section=section.heading, text=value.strip()),
    )


def _confidence_from_evidence(
    value: str,
    signals: tuple[str, ...],
) -> tuple[float, dict[str, Any]]:
    unique_signals = list(dict.fromkeys(signals))
    if _looks_like_coherent_text(value):
        unique_signals.append("coherent_text")
    if _looks_like_ocr_artifact(value):
        unique_signals.append("possible_ocr_artifact")

    components = [
        {"signal": signal, "impact": CONFIDENCE_SIGNALS[signal]}
        for signal in unique_signals
        if signal in CONFIDENCE_SIGNALS
    ]
    score = CONFIDENCE_BASE + sum(component["impact"] for component in components)
    score = round(max(0.05, min(0.98, score)), 2)
    return score, {
        "method": "semantic_rules_v1",
        "base": CONFIDENCE_BASE,
        "signals": components,
    }


def _looks_like_coherent_text(value: str) -> bool:
    compact = value.strip()
    if not 3 <= len(compact) <= 2000:
        return False
    alpha = sum(character.isalpha() for character in compact)
    return alpha >= 3 and alpha / max(1, len(compact)) >= 0.35


def _looks_like_ocr_artifact(value: str) -> bool:
    if "\ufffd" in value:
        return True
    tokens = value.split()
    mixed_tokens = sum(
        bool(re.search(r"[A-Za-zÄÖÜäöüß]\d|\d[A-Za-zÄÖÜäöüß]", token))
        for token in tokens
    )
    return bool(tokens) and mixed_tokens >= 2


def _section_at_page(section: Section, page: int | None) -> Section:
    return replace(section, page=page, line_pages=[])


def _strip_row_prefix(line: str) -> str:
    value = re.sub(
        r"^\s*(?:[•*\-–—]+\s*|(?:\d+|[a-z])[.)]\s+|o\s{2,})",
        "",
        line,
    ).strip()
    dated = DATE_AT_START_RE.match(value)
    if dated and dated.group("text"):
        return dated.group("text").strip()
    return value


def _is_negative_assessment(value: str, include_rule_out: bool = True) -> bool:
    return bool(NEGATION_RE.search(value) or (include_rule_out and RULE_OUT_RE.search(value)))


def _diagnosis_has_negation(value: str) -> bool:
    """Detect an assertion about the diagnosis, not an incidental modifier.

    A broad ``\bohne\b`` search made a confirmed event such as a stroke become
    negated merely because its narrative said ``bislang ohne Antikoagulation``.
    Leading negation and explicit negated predicates remain safety-sensitive.
    """

    return bool(LEADING_NEGATION_RE.search(value) or NEGATED_PREDICATE_RE.search(value))


def _diagnosis_semantics(value: str) -> DiagnosisSemantics:
    if FAMILY_HISTORY_RE.search(value):
        return DiagnosisSemantics(
            target="anamnesis",
            assertion="family_history",
            semantic_role="family_history",
            certainty=None,
            auto_select=True,
            review_reasons=(),
            confidence_signals=(
                "recognized_heading",
                "family_history_context",
                "redirected_from_diagnosis",
            ),
        )
    if HISTORY_RE.match(value) or DEVICE_HISTORY_RE.match(value):
        return DiagnosisSemantics(
            target="anamnesis",
            assertion="historical",
            semantic_role="personal_history",
            certainty=None,
            auto_select=True,
            review_reasons=(),
            confidence_signals=(
                "recognized_heading",
                "explicit_history",
                "redirected_from_diagnosis",
            ),
        )
    if RULE_OUT_RE.search(value):
        return DiagnosisSemantics(
            target="examination",
            assertion="rule_out",
            semantic_role="diagnostic_intent",
            certainty=None,
            auto_select=False,
            review_reasons=("rule_out_is_not_an_active_diagnosis",),
            confidence_signals=(
                "recognized_heading",
                "explicit_rule_out",
                "redirected_from_diagnosis",
                "requires_clinical_confirmation",
            ),
        )
    if DIAGNOSIS_DETAIL_RE.search(value):
        return DiagnosisSemantics(
            target="examination",
            assertion="documented",
            semantic_role="diagnosis_detail",
            certainty=None,
            auto_select=True,
            review_reasons=(),
            confidence_signals=(
                "recognized_heading",
                "redirected_from_diagnosis",
                "specific_section_role",
            ),
        )
    if _diagnosis_has_negation(value):
        return DiagnosisSemantics(
            target="examination",
            assertion="negated",
            semantic_role="negative_finding",
            certainty=None,
            auto_select=False,
            review_reasons=("negative_statement_is_not_an_active_diagnosis",),
            confidence_signals=(
                "recognized_heading",
                "explicit_negation",
                "redirected_from_diagnosis",
                "requires_clinical_confirmation",
            ),
        )
    if ENCOUNTER_RE.search(value):
        return DiagnosisSemantics(
            target="examination",
            assertion="documented",
            semantic_role="encounter",
            certainty=None,
            auto_select=True,
            review_reasons=(),
            confidence_signals=(
                "recognized_heading",
                "encounter_term",
                "redirected_from_diagnosis",
            ),
        )
    if SUSPICION_RE.search(value):
        return DiagnosisSemantics(
            target="diagnosis",
            assertion="suspected",
            semantic_role="diagnosis",
            certainty="verdacht",
            auto_select=False,
            review_reasons=("suspected_diagnosis_requires_confirmation",),
            confidence_signals=(
                "recognized_heading",
                "diagnosis_section",
                "explicit_suspicion",
                "requires_clinical_confirmation",
            ),
        )
    return DiagnosisSemantics(
        target="diagnosis",
        assertion="confirmed",
        semantic_role="diagnosis",
        certainty="bestaetigt",
        auto_select=True,
        review_reasons=(),
        confidence_signals=(
            "recognized_heading",
            "diagnosis_section",
            "explicit_positive_context",
        ),
    )


def _split_diagnosis_assertion_clauses(value: str) -> list[str]:
    # Diagnosis blocks are already processed line by line. Splitting on full
    # stops would corrupt German assertion abbreviations such as ``Z.n.`` and
    # ``V.a.``; semicolons and an assertion introduced after a comma are safe
    # boundaries for the structured lists handled here.
    clauses = re.split(r"\s*;\s*", value)
    split_clauses: list[str] = []
    assertion_after_comma = re.compile(
        r",\s+(?=(?:kein(?:e|en|em|er|es)?|ohne|verneint|Ausschluss|"
        r"Z\s*\.?\s*n\s*\.?|Zustand\s+nach|V\s*\.?\s*a\s*\.?|Verdacht)\b)",
        re.IGNORECASE,
    )
    for clause in clauses:
        split_clauses.extend(assertion_after_comma.split(clause))
    return [clause.strip(" ,") for clause in split_clauses if clause.strip(" ,")]


def _looks_like_standalone_oncology_diagnosis(value: str) -> bool:
    compact = value.strip()
    if not compact or ONCOLOGY_DIAGNOSIS_CONTINUATION_RE.match(compact):
        return False
    if HISTORY_RE.match(compact) or DEVICE_HISTORY_RE.match(compact):
        return True
    if LOWERCASE_CLINICAL_LABEL_RE.match(compact):
        return True
    if len(compact) > 60 or compact[0].islower():
        return False
    return not bool(re.search(r"[.;]", compact))


def _diagnosis_rows(
    section: Section,
    *,
    fold_wrapped: bool,
) -> list[tuple[str, int | None]]:
    if not fold_wrapped:
        return [
            (
                _strip_row_prefix(line),
                section.line_pages[index] if index < len(section.line_pages) else section.page,
            )
            for index, line in enumerate(section.text.splitlines())
            if _strip_row_prefix(line)
        ]

    rows: list[tuple[str, int | None]] = []
    current_lines: list[str] = []
    current_page: int | None = section.page

    def flush() -> None:
        nonlocal current_lines, current_page
        value = ""
        for part in (part.strip() for part in current_lines if part.strip()):
            if value.endswith("-") and part[:1].islower():
                value = f"{value[:-1]}{part}"
            else:
                value = f"{value} {part}".strip()
        value = re.sub(r"\bmm/(?:20yy|yyyy)\b", "", value, flags=re.IGNORECASE)
        value = " ".join(value.split()).strip(" ,;")
        if value:
            rows.append((value, current_page))
        current_lines = []
        current_page = section.page

    skipping_code_block = False
    for index, line in enumerate(section.text.splitlines()):
        page = section.line_pages[index] if index < len(section.line_pages) else section.page
        compact = line.strip()
        if DIAGNOSIS_CODE_BLOCK_RE.match(compact):
            flush()
            skipping_code_block = True
            continue
        dated = DATE_AT_START_RE.match(compact)
        list_item = re.match(
            r"^(?:[•*\-–—]+\s*|(?:\d+|[a-z])[.)]\s+|o\s{2,})",
            compact,
        )
        if skipping_code_block and not (dated or list_item):
            continue
        if dated or list_item:
            skipping_code_block = False
        value = _strip_row_prefix(line)
        if not value:
            continue
        if dated or list_item or (current_lines and _looks_like_standalone_oncology_diagnosis(value)):
            flush()
            current_page = page
        elif not current_lines:
            current_page = page
        current_lines.append(value)
    flush()
    return rows


def _diagnosis_candidates(
    section: Section,
    *,
    fold_wrapped: bool = False,
) -> list[ClinicalCandidate]:
    rows: list[ClinicalCandidate] = []
    for row_value, page in _diagnosis_rows(section, fold_wrapped=fold_wrapped):
        if not row_value or len(row_value) < 3:
            continue
        candidate_section = _section_at_page(section, page)
        for value in _split_diagnosis_assertion_clauses(row_value):
            semantics = _diagnosis_semantics(value)
            common = {
                "assertion": semantics.assertion,
                "semantic_role": semantics.semantic_role,
                "auto_select": semantics.auto_select,
                "review_reasons": list(semantics.review_reasons),
            }
            if semantics.target == "diagnosis":
                normalized = {
                    **common,
                    "label": value,
                    "kind": "secondary",
                    "certainty": semantics.certainty,
                    "source_mode": "extern",
                }
            elif semantics.target == "anamnesis":
                normalized = {
                    **common,
                    "anamnese_aktuelle": value,
                    "history_text": value,
                    "section_role": semantics.semantic_role,
                }
            else:
                normalized = {
                    **common,
                    "title": value if semantics.semantic_role == "encounter" else "Diagnostische Aussage",
                    "result": value,
                    "status": "final",
                    "kind": "other",
                    "section_role": semantics.semantic_role,
                }
            rows.append(
                _candidate(
                    semantics.target,
                    value,
                    normalized,
                    candidate_section,
                    semantics.confidence_signals,
                )
            )
    return rows


MEDICATION_NEGATION_RE = re.compile(
    r"(?:\b(?:keine|ohne)\s+(?:(?:aktuelle|dauer|entlassungs|h[aä]usliche)\s*)?"
    r"(?:medikation|medikamente|arzneimittel)\b|"
    r"\b(?:medikation|medikamente)\s*[:\-]\s*(?:keine|nein|ohne)\b)",
    re.IGNORECASE,
)
MEDICATION_EMPTY_ROW_RE = re.compile(
    r"^\s*(?:(?:keine|ohne)\s+(?:(?:aktuelle|dauer|entlassungs|h[aä]usliche)\s*)?"
    r"(?:medikation|medikamente|arzneimittel)|keine|nein|ohne)\s*[.!]?\s*$",
    re.IGNORECASE,
)
MEDICATION_STOPPED_RE = re.compile(
    r"\b(?:abgesetzt|beendet|gestoppt|nicht\s+mehr\s+einnehmen|ausgeschlichen)\b",
    re.IGNORECASE,
)
MEDICATION_PAUSED_RE = re.compile(
    r"\b(?:pausiert|pause|vor[uü]bergehend\s+ausgesetzt|Einnahme\s+ausgesetzt|ruhend)\b",
    re.IGNORECASE,
)
MEDICATION_PLANNED_RE = re.compile(r"\b(?:geplant|vorgesehen|soll\s+beginnen)\b", re.IGNORECASE)
MEDICATION_ACTIVE_RE = re.compile(
    r"\b(?:Status\s*[:=-]?\s*(?:aktiv|active)|aktive\s+Einnahme|"
    r"wird\s+aktuell\s+eingenommen|weiter(?:hin)?\s+einnehmen|"
    r"fort(?:zu)?f[uü]hren)\b",
    re.IGNORECASE,
)
MEDICATION_PRN_RE = re.compile(
    r"\b(?:bei\s+Bedarf|bedarfsweise|falls\s+erforderlich|p\.?\s*r\.?\s*n\.?|s\.?\s*o\.?\s*s\.?)\b",
    re.IGNORECASE,
)
MEDICATION_PZN_RE = re.compile(r"\bPZN\s*[:#-]?\s*(?P<value>\d[\d\s-]{5,10}\d)\b", re.IGNORECASE)
MEDICATION_ATC_RE = re.compile(r"\bATC\s*[:#-]?\s*(?P<value>[A-Z]\d{2}[A-Z]{2}\d{2})\b", re.IGNORECASE)
MEDICATION_STRENGTH_RE = re.compile(
    r"(?<![\w.,])(?P<value>"
    r"(?:\d+(?:[.,]\d+)?\s*(?:-|/|\N{EN DASH})\s*)*\d+(?:[.,]\d+)?\s*"
    r"(?:mg|g|µg|mcg|ng|ml|l|IE|I\.E\.|E|mmol|%)"
    r"(?:\s*/\s*(?:\d+(?:[.,]\d+)?\s*)?(?:mg|g|µg|mcg|ml|l|IE|I\.E\.|Hub|Dosis|Tabl?\.?))?"
    r")",
    re.IGNORECASE,
)
MEDICATION_DOSE_TOKEN = r"(?:\d+(?:[.,]\d+)?|\d+\s*/\s*\d+|[½¼¾])"
MEDICATION_SCHEDULE_RE = re.compile(
    rf"(?<![\w/])(?P<m>{MEDICATION_DOSE_TOKEN})\s*[-–]\s*"
    rf"(?P<d>{MEDICATION_DOSE_TOKEN})\s*[-–]\s*"
    rf"(?P<e>{MEDICATION_DOSE_TOKEN})"
    rf"(?:\s*[-–]\s*(?P<n>{MEDICATION_DOSE_TOKEN}))?(?![\w/])"
)
MEDICATION_FORM_PATTERNS: tuple[tuple[re.Pattern[str], str, str | None], ...] = (
    (re.compile(r"\b(?:Retardtabletten?|Retardkapseln?)\b", re.IGNORECASE), "Retardpräparat", "oral"),
    (re.compile(r"\b(?:Tabl?\.?|Tbl\.?|Filmtbl?\.?|(?:Film)?tabletten?)\b", re.IGNORECASE), "Tablette", "oral"),
    (re.compile(r"\b(?:Kaps?\.?|Kapseln?)\b", re.IGNORECASE), "Kapsel", "oral"),
    (re.compile(r"\b(?:Tropfen|Trpf\.?)\b", re.IGNORECASE), "Tropfen", "oral"),
    (re.compile(r"\b(?:Saft|L[oö]sung)\b", re.IGNORECASE), "Lösung", "oral"),
    (re.compile(r"\b(?:Inhalat(?:or|ion)?|Dosieraerosol)\b", re.IGNORECASE), "Inhalation", "inhalativ"),
    (re.compile(r"\b(?:Creme|Salbe|Gel)\b", re.IGNORECASE), "Creme/Salbe", "kutan"),
    (re.compile(r"\b(?:Suppositorien?|Z[aä]pfchen)\b", re.IGNORECASE), "Suppositorium", "rektal"),
    (re.compile(r"\b(?:Inj(?:ektion)?|Fertigspritze|Ampulle)\b", re.IGNORECASE), "Injektion", "parenteral"),
    (re.compile(r"\b(?:Pflaster|transdermal)\b", re.IGNORECASE), "Pflaster", "transdermal"),
)
MEDICATION_HEADER_FIELDS = {
    "wirkstoff": "wirkstoff",
    "arzneimittelwirkstoff": "wirkstoff",
    "handelsname": "handelsname",
    "präparat": "handelsname",
    "praeparat": "handelsname",
    "arzneimittel": "handelsname",
    "medikament": "handelsname",
    "stärke": "staerke",
    "staerke": "staerke",
    "wirkstärke": "staerke",
    "wirkstaerke": "staerke",
    "form": "form",
    "darreichungsform": "form",
    "einnahmeform": "einnahmeform",
    "morgens": "dose_morgens",
    "mittags": "dose_mittags",
    "abends": "dose_abends",
    "nachts": "dose_nachts",
    "zurnacht": "dose_nachts",
    "einheit": "einheit",
    "hinweis": "hinweis",
    "hinweise": "hinweis",
    "grund": "grund",
    "indikation": "grund",
    "status": "status_text",
    "atc": "atc",
    "pzn": "pzn",
    "dosierung": "schedule",
    "dosierschema": "schedule",
    "einnahme": "schedule",
    "bemerkung": "hinweis",
    "verordnetam": "verordnet_am",
    "einnahmevon": "einnahme_von",
    "einnahmebis": "einnahme_bis",
}


def _source_country(text: str) -> str | None:
    country_markers = (
        ("DE", r"\b(?:Deutschland|Germany|Bundesrepublik\s+Deutschland)\b"),
        ("AT", r"\b(?:[OÖ]sterreich|Austria)\b"),
        ("CH", r"\b(?:Schweiz|Switzerland|Suisse)\b"),
        ("UA", r"\b(?:Ukraine|Україна)\b"),
        ("PL", r"\b(?:Polen|Poland|Polska)\b"),
        ("FR", r"\b(?:Frankreich|France)\b"),
        ("IT", r"\b(?:Italien|Italy|Italia)\b"),
        ("ES", r"\b(?:Spanien|Spain|España)\b"),
        ("GB", r"\b(?:Vereinigtes\s+K[oö]nigreich|United\s+Kingdom|Great\s+Britain)\b"),
        ("US", r"\b(?:USA|United\s+States|Vereinigte\s+Staaten)\b"),
    )
    # Country changes drug-catalog matching, so only accept a marker from the
    # document header (or an explicitly labeled country line). A nationality
    # mentioned later in the clinical narrative is not document provenance.
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line_index, line in enumerate(lines):
        if line_index >= 12 and not re.match(r"^(?:Land|Country|Pays|Paese)\s*:", line, re.IGNORECASE):
            continue
        if len(line) > 120:
            continue
        for code, pattern in country_markers:
            if re.search(pattern, line, re.IGNORECASE):
                return code
    return None


def _medication_candidates(
    section: Section,
    *,
    source_country: str | None = None,
    document_date: str | None = None,
) -> tuple[list[ClinicalCandidate], list[str]]:
    text = section.text.strip()
    contains_explicit_negation = bool(MEDICATION_NEGATION_RE.search(text)) or any(
        MEDICATION_EMPTY_ROW_RE.fullmatch(line.strip()) for line in text.splitlines()
    )

    rows: list[ClinicalCandidate] = []
    repaired = _repair_wrapped_date_lines(
        list(zip(text.splitlines(), section.line_pages, strict=False))
    )
    heading_date_match = re.search(
        r"\b(?:vom|am)\s+(\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2}))\b",
        section.heading,
        re.IGNORECASE,
    )
    inherited_date = heading_date_match.group(1) if heading_date_match else document_date
    entries: list[tuple[str, str | None, int | None, dict[str, str] | None]] = []
    current_lines: list[str] = []
    current_date: str | None = inherited_date
    current_page: int | None = section.page
    table_headers: list[str | None] | None = None

    def flush(*, clear_date: bool = False) -> None:
        nonlocal current_lines, current_date, current_page
        if current_lines:
            repaired_value = _repair_wrapped_example_brand("\n".join(current_lines).strip())
            entries.append((repaired_value, current_date, current_page, None))
        current_lines = []
        if clear_date:
            current_date = inherited_date
        current_page = section.page

    for line, page in repaired:
        stripped = line.strip()
        if not stripped:
            continue
        detected_headers = _medication_table_headers(stripped)
        if detected_headers:
            flush()
            table_headers = detected_headers
            continue
        if table_headers:
            if re.match(
                r"^(?:\(?Die\s+aufgef[uü]hrten|Laborwerte|Wichtiger\s+Hinweis)\b",
                stripped,
                re.IGNORECASE,
            ):
                break
            mapped = _medication_table_values(table_headers, stripped)
            if _is_structured_medication_row(mapped, stripped):
                flush()
                entries.append((stripped, current_date, page, mapped))
                continue
            if (
                entries
                and entries[-1][3] is not None
                and not stripped.startswith("(")
                and not re.match(r"^(?:Die\s+aufgef[uü]hrten|Laborwerte)\b", stripped, re.IGNORECASE)
            ):
                entry, entry_date, entry_page, structured_values = entries[-1]
                assert structured_values is not None
                structured_values["hinweis"] = _join_wrapped_text(
                    structured_values.get("hinweis", ""),
                    stripped,
                )
                entries[-1] = (
                    _join_wrapped_text(entry, stripped),
                    entry_date,
                    entry_page,
                    structured_values,
                )
                continue
        dated = DATE_AT_START_RE.match(stripped)
        if dated:
            flush(clear_date=True)
            current_date = dated.group("date")
            current_page = page
            remainder = dated.group("text").strip()
            if remainder:
                current_lines.append(remainder)
            continue
        if current_lines and _starts_new_medication_line(" ".join(current_lines), stripped):
            retained_date = current_date
            flush()
            current_date = retained_date
        if not current_lines:
            current_page = page
        current_lines.append(stripped)
    flush()

    warnings: list[str] = (
        ["Medication section contains an explicit negation; negated rows were not proposed."]
        if contains_explicit_negation
        else []
    )
    for entry, raw_date, page, structured in entries:
        values = [entry] if structured else _split_medication_items(entry)
        for value in values:
            if MEDICATION_EMPTY_ROW_RE.fullmatch(value.strip()):
                continue
            normalized = _normalize_medication(
                value,
                raw_date=raw_date,
                source_country=source_country,
                structured=structured,
                active_context=_medication_active_context(section, structured),
            )
            signals = ["recognized_heading"]
            if structured:
                signals.append("structured_medication_row")
            elif _has_medication_dose_pattern(value):
                signals.append("dose_pattern")
            else:
                signals.append("section_body")
            if normalized.get("wirkstoff"):
                signals.append("explicit_active_ingredient")
            if normalized.get("status") in {"pausiert", "abgesetzt"}:
                signals.append("medication_lifecycle")
            rows.append(
                _candidate(
                    "medication",
                    " ".join(value.split()),
                    normalized,
                    _section_at_page(section, page),
                    tuple(signals),
                )
            )
            if not normalized["auto_select"]:
                warnings.append("One or more medication candidates require structured review.")
    return rows, list(dict.fromkeys(warnings))


def _medication_active_context(
    section: Section,
    structured: dict[str, str] | None,
) -> str | None:
    if structured is not None:
        return "structured_current_medication_table"
    heading_key = _heading_key(section.heading)
    if heading_key.startswith(
        (
            "aktuellemedikation",
            "dauermedikation",
            "entlassungsmedikation",
            "medikationbeientlassung",
            "empfohlenemedikation",
            "häuslichemedikation",
            "medikationsplan",
            "bundeseinheitlichermedikationsplan",
        )
    ):
        return "explicit_current_medication_section"
    return None


def _medication_table_headers(line: str) -> list[str | None] | None:
    cells = _lab_cells(line)
    if len(cells) < 2:
        return None
    mapped: list[str | None] = []
    recognized = 0
    for cell in cells:
        key = _heading_key(cell)
        field_name = MEDICATION_HEADER_FIELDS.get(key)
        mapped.append(field_name)
        recognized += field_name is not None
    if recognized < 2 or not any(field in {"wirkstoff", "handelsname"} for field in mapped):
        return None
    return mapped


def _medication_table_values(headers: list[str | None], line: str) -> dict[str, str]:
    cells = _lab_cells(line)
    values: dict[str, str] = {}
    if (
        len(cells) == len(headers) + 1
        and headers[-1] == "hinweis"
        and re.fullmatch(r"(?:p\.?o\.?|i\.?v\.?|s\.?c\.?)", cells[-2], re.IGNORECASE)
    ):
        values["einnahmeform"] = cells[-2]
        cells = [*cells[:-2], cells[-1]]
    for index, field_name in enumerate(headers):
        if field_name is None or index >= len(cells):
            continue
        value = cells[index].strip()
        if value:
            values[field_name] = value
    return values


def _is_structured_medication_row(values: dict[str, str], line: str) -> bool:
    if not (values.get("wirkstoff") or values.get("handelsname")):
        return False
    if _has_medication_dose_pattern(line):
        return True
    if any(
        values.get(field_name)
        for field_name in (
            "dose_morgens",
            "dose_mittags",
            "dose_abends",
            "dose_nachts",
            "schedule",
            "status_text",
        )
    ):
        return True
    return bool(
        MEDICATION_STOPPED_RE.search(line)
        or MEDICATION_PAUSED_RE.search(line)
        or MEDICATION_PLANNED_RE.search(line)
    )


def _join_wrapped_text(existing: str, continuation: str) -> str:
    left = existing.rstrip()
    right = continuation.lstrip()
    if not left:
        return right
    if left.endswith("-") and right and right[0].islower():
        return f"{left[:-1]}{right}"
    return f"{left} {right}"


def _repair_wrapped_example_brand(value: str) -> str:
    lines = [line.strip() for line in value.splitlines() if line.strip()]
    if len(lines) != 2:
        return value
    first, second = lines
    if not re.fullmatch(r"[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß®.-]*\)", second):
        return value
    match = re.match(
        r"^(?P<prefix>.*\(\s*z\.?\s*B\.?\s+[^()\s]+-)\s{2,}(?P<tail>.+)$",
        first,
        re.IGNORECASE,
    )
    if not match:
        return value
    return f"{match.group('prefix')}{second} {match.group('tail').strip()}"


def _starts_new_medication_line(current: str, following: str) -> bool:
    if following.startswith((",", ";", ")")):
        return False
    if re.match(r"^(?:\d|[½¼¾]|mg\b|g\b|µg\b|mcg\b|ml\b)", following, re.IGNORECASE):
        return False
    if re.match(
        r"^(?:bei\s+Bedarf|morgens|mittags|abends|nachts|zur\s+Nacht|"
        r"nach|vor|zu\s+den|und\b|sowie\b)",
        following,
        re.IGNORECASE,
    ):
        return False
    if any(pattern.match(following) for pattern, _, _ in MEDICATION_FORM_PATTERNS):
        return False
    if current.rstrip().endswith((",", "/", "-", "(")):
        return False
    if current.count("(") > current.count(")"):
        return False
    if following.endswith(")") and not _has_medication_dose_pattern(following):
        return False
    return bool(re.match(r"^[A-ZÄÖÜ][\wÄÖÜäöüß®+./-]{2,}", following))


def _normalize_medication(
    raw_value: str,
    *,
    raw_date: str | None,
    source_country: str | None,
    structured: dict[str, str] | None,
    active_context: str | None,
) -> dict[str, Any]:
    raw_text = raw_value.strip()
    field_confidence: dict[str, float] = {"raw_text": 1.0}
    field_evidence: dict[str, str] = {"raw_text": "candidate_source_row"}
    review_reasons: list[str] = []
    structured = structured or {}

    identifiers: dict[str, str | None] = {"atc": None, "pzn": None}
    atc_match = MEDICATION_ATC_RE.search(raw_text)
    pzn_match = MEDICATION_PZN_RE.search(raw_text)
    atc = structured.get("atc") or (atc_match.group("value").upper() if atc_match else None)
    pzn_raw = structured.get("pzn") or (pzn_match.group("value") if pzn_match else None)
    pzn = re.sub(r"\D", "", pzn_raw) if pzn_raw else None
    if atc:
        identifiers["atc"] = atc.strip().upper()
        field_confidence["identifiers.atc"] = 0.98 if structured.get("atc") else 0.94
        field_evidence["identifiers.atc"] = "labeled_table_cell" if structured.get("atc") else "explicit_atc_label"
        if not re.fullmatch(r"[A-Z]\d{2}[A-Z]{2}\d{2}", identifiers["atc"] or ""):
            review_reasons.append("atc_requires_confirmation")
    if pzn:
        identifiers["pzn"] = pzn
        field_confidence["identifiers.pzn"] = 0.98 if structured.get("pzn") else 0.94
        field_evidence["identifiers.pzn"] = "labeled_table_cell" if structured.get("pzn") else "explicit_pzn_label"
        if len(pzn) != 8:
            review_reasons.append("pzn_requires_confirmation")

    status_text = structured.get("status_text") or raw_text
    structured_status = _clean_optional(structured.get("status_text"))
    explicit_status_label = bool(
        structured.get("status_text")
        or re.search(r"\bStatus\s*[:=-]\s*\S+", raw_text, re.IGNORECASE)
    )
    stopped = bool(MEDICATION_STOPPED_RE.search(status_text))
    pause_match = MEDICATION_PAUSED_RE.search(status_text)
    paused = bool(pause_match)
    planned = bool(MEDICATION_PLANNED_RE.search(status_text))
    explicit_active = (
        (structured_status or "").casefold() in {"aktiv", "active", "laufend"}
        or bool(MEDICATION_ACTIVE_RE.search(status_text))
    ) and not bool(re.search(r"\bnicht\s+aktiv\b", status_text, re.IGNORECASE))
    if stopped:
        status, assertion, on_hold = "abgesetzt", "stopped", False
    elif paused:
        status, assertion, on_hold = "pausiert", "on_hold", True
    elif planned:
        status, assertion, on_hold = "geplant", "planned", False
    else:
        status, assertion, on_hold = "aktiv", "active", False
    recognized_explicit_status = stopped or paused or planned or explicit_active
    if recognized_explicit_status:
        field_confidence["status"] = 0.97
        field_evidence["status"] = (
            "explicit_active_status" if explicit_active else "explicit_lifecycle_term"
        )
    elif explicit_status_label:
        field_confidence["status"] = 0.4
        field_evidence["status"] = "unrecognized_explicit_status"
    elif active_context:
        field_confidence["status"] = 0.65
        field_evidence["status"] = f"{active_context}_without_explicit_status"
    else:
        field_confidence["status"] = 0.45
        field_evidence["status"] = "active_status_inferred_only_by_absence"
    field_confidence["on_hold"] = field_confidence["status"]
    field_evidence["on_hold"] = field_evidence["status"]

    schedule_source = structured.get("schedule") or raw_text
    schedule = MEDICATION_SCHEDULE_RE.search(schedule_source)
    doses: dict[str, str | None] = {
        "dose_morgens": _clean_optional(structured.get("dose_morgens")),
        "dose_mittags": _clean_optional(structured.get("dose_mittags")),
        "dose_abends": _clean_optional(structured.get("dose_abends")),
        "dose_nachts": _clean_optional(structured.get("dose_nachts")),
    }
    if schedule:
        for field_name, group_name in (
            ("dose_morgens", "m"),
            ("dose_mittags", "d"),
            ("dose_abends", "e"),
            ("dose_nachts", "n"),
        ):
            if doses[field_name] is None and schedule.group(group_name):
                doses[field_name] = schedule.group(group_name).replace(" ", "")
    for field_name, aliases in (
        ("dose_morgens", r"morgens|fr[uü]h"),
        ("dose_mittags", r"mittags"),
        ("dose_abends", r"abends"),
        ("dose_nachts", r"nachts|zur\s+Nacht"),
    ):
        if doses[field_name] is None:
            named = re.search(rf"\b(?:{aliases})\s*[:=]?\s*({MEDICATION_DOSE_TOKEN})\b", raw_text, re.IGNORECASE)
            if named:
                doses[field_name] = named.group(1).replace(" ", "")
        if doses[field_name] is None:
            reverse_named = re.search(
                rf"\b({MEDICATION_DOSE_TOKEN})\s*"
                rf"(?:Tabletten?|Kapseln?|Tropfen|H[uü]be?|Hub|Spr[uü]hst[oö][sß]e?)?\s*"
                rf"(?:{aliases})\b",
                raw_text,
                re.IGNORECASE,
            )
            if reverse_named:
                doses[field_name] = reverse_named.group(1).replace(" ", "")
        if doses[field_name] is not None:
            field_confidence[field_name] = 0.98 if structured.get(field_name) else 0.94
            field_evidence[field_name] = "labeled_table_cell" if structured.get(field_name) else "bmp_or_named_dose_pattern"
    if (
        not schedule
        and not MEDICATION_STRENGTH_RE.search(raw_text)
        and re.search(r"\b\d+(?:[.,]\d+)?\s*[-–]\s*\d+(?:[.,]\d+)?\b", raw_text)
    ):
        review_reasons.append("dose_schedule_requires_confirmation")

    strength = _clean_optional(structured.get("staerke"))
    strength_match = MEDICATION_STRENGTH_RE.search(raw_text)
    if strength is None and strength_match:
        strength = re.sub(r"\s+", " ", strength_match.group("value")).strip()
    if strength:
        field_confidence["staerke"] = 0.98 if structured.get("staerke") else 0.93
        field_evidence["staerke"] = "labeled_table_cell" if structured.get("staerke") else "strength_unit_pattern"

    form = _clean_optional(structured.get("form"))
    route = _canonical_medication_route(structured.get("einnahmeform"))
    inferred_form: tuple[str, str | None] | None = None
    for pattern, canonical_form, canonical_route in MEDICATION_FORM_PATTERNS:
        if pattern.search(raw_text):
            inferred_form = (canonical_form, canonical_route)
            break
    if form is None and inferred_form:
        form = inferred_form[0]
    if route is None and inferred_form:
        route = inferred_form[1]
    if route is None:
        explicit_route = re.search(
            r"\b(?P<route>p\.?\s*o\.?|i\.?\s*v\.?|s\.?\s*c\.?|i\.?\s*m\.?)\b",
            raw_text,
            re.IGNORECASE,
        )
        if explicit_route:
            route = _canonical_medication_route(explicit_route.group("route"))
    if form:
        field_confidence["form"] = 0.98 if structured.get("form") else 0.88
        field_evidence["form"] = "labeled_table_cell" if structured.get("form") else "dosage_form_term"
    if route:
        field_confidence["einnahmeform"] = 0.98 if structured.get("einnahmeform") else 0.8
        field_evidence["einnahmeform"] = "labeled_table_cell" if structured.get("einnahmeform") else "route_inferred_from_form"

    einheit = _clean_optional(structured.get("einheit"))
    if einheit is None and form and any(value is not None for value in doses.values()):
        einheit = form
    if einheit is None and any(value is not None for value in doses.values()):
        unit_match = re.search(
            rf"\b{MEDICATION_DOSE_TOKEN}\s*(?P<unit>Hub|H[uü]be|Tropfen|"
            r"Spr[uü]hst[oö][sß]e?|Tabletten?|Kapseln?)\b",
            raw_text,
            re.IGNORECASE,
        )
        if unit_match:
            einheit = unit_match.group("unit")
    if einheit:
        field_confidence["einheit"] = 0.98 if structured.get("einheit") else 0.78
        field_evidence["einheit"] = "labeled_table_cell" if structured.get("einheit") else "dose_unit_inferred_from_form"

    wirkstoff, handelsname, name_confidence, name_evidence = _medication_names(raw_text, structured)
    if wirkstoff is not None:
        field_confidence["wirkstoff"] = name_confidence.get("wirkstoff", 0.9)
        field_evidence["wirkstoff"] = name_evidence.get("wirkstoff", "explicit_active_ingredient")
    if handelsname is not None:
        field_confidence["handelsname"] = name_confidence.get("handelsname", 0.85)
        field_evidence["handelsname"] = name_evidence.get("handelsname", "extracted_product_name")

    as_needed = bool(MEDICATION_PRN_RE.search(raw_text))
    if as_needed:
        field_confidence["as_needed"] = 0.97
        field_evidence["as_needed"] = "explicit_prn_term"
        field_confidence["category"] = 0.97
        field_evidence["category"] = "explicit_prn_term"
    hinweis = _clean_optional(structured.get("hinweis")) or _labeled_medication_text(raw_text, "Hinweis|Anweisung")
    structured_schedule = _clean_optional(structured.get("schedule"))
    if structured_schedule and schedule is None:
        hinweis = _join_wrapped_text(structured_schedule, hinweis or "")
        review_reasons.append("dose_time_requires_confirmation")
    if hinweis is None:
        instructions = [
            match.group(0).strip(" ,.;")
            for pattern in (
                MEDICATION_PRN_RE,
                re.compile(r"\b(?:n[uü]chtern|vor|nach|zu\s+den)\s+(?:dem\s+)?(?:Essen|Mahlzeiten?|Fr[uü]hst[uü]ck)\b", re.IGNORECASE),
                re.compile(r"\bmax\.?\s+\d+(?:[.,]\d+)?\s*(?:x|mal)?\s*(?:t[aä]glich|pro\s+Tag)?", re.IGNORECASE),
                re.compile(r"\b\d+\s*[x×]\s*(?:t[aä]glich|pro\s+Tag|w[oö]chentlich)\b", re.IGNORECASE),
            )
            for match in [pattern.search(raw_text)]
            if match
        ]
        hinweis = "; ".join(dict.fromkeys(instructions)) or None
    grund = _clean_optional(structured.get("grund")) or _labeled_medication_text(raw_text, "Grund|Indikation")
    for field_name, value in (("hinweis", hinweis), ("grund", grund)):
        if value:
            field_confidence[field_name] = 0.98 if structured.get(field_name) else 0.9
            field_evidence[field_name] = "labeled_table_cell" if structured.get(field_name) else "explicit_instruction_label_or_phrase"

    normalized_source_date = _normalize_medication_date(raw_date)
    if raw_date and normalized_source_date is None:
        review_reasons.append("source_date_requires_confirmation")
    verordnet_am = _normalize_medication_date(structured.get("verordnet_am")) or _medication_date_after(
        raw_text, r"verordnet(?:\s+(?:am|vom))?"
    )
    einnahme_von = _normalize_medication_date(structured.get("einnahme_von")) or _medication_date_after(
        raw_text, r"(?:Einnahmebeginn|Beginn|Start|seit|ab)(?!gesetzt)"
    )
    stop_date = _medication_date_after(raw_text, r"(?:abgesetzt|beendet|gestoppt)(?:\s+(?:am|zum))?")
    einnahme_bis = _normalize_medication_date(structured.get("einnahme_bis")) or stop_date
    if einnahme_bis is None:
        einnahme_bis = _medication_date_after(
            raw_text,
            r"(?:Einnahme\s+)?bis(?:\s+(?:zum|einschlie[ßs]lich|einschl\.?|inkl\.?))?",
        )
    hold_from = _medication_date_after(raw_text, r"(?:pausiert|Pause|ausgesetzt)\s+(?:seit|ab|vom)") if paused else None
    hold_until = _medication_date_after(raw_text, r"(?:pausiert|Pause|ausgesetzt).*?bis(?:\s+zum)?") if paused else None
    for field_name, value in (
        ("source_date", normalized_source_date or raw_date),
        ("verordnet_am", verordnet_am),
        ("einnahme_von", einnahme_von),
        ("einnahme_bis", einnahme_bis),
        ("hold_from", hold_from),
        ("hold_until", hold_until),
    ):
        if value:
            if field_name == "source_date" and raw_date and normalized_source_date is None:
                field_confidence[field_name] = 0.45
                field_evidence[field_name] = "unvalidated_source_date_text"
            else:
                field_confidence[field_name] = 0.98 if structured.get(field_name) else 0.92
                field_evidence[field_name] = "labeled_table_cell" if structured.get(field_name) else "explicit_date_context"

    hold_note = pause_match.group(0) if pause_match else None
    if hold_note:
        field_confidence["hold_note"] = 0.94
        field_evidence["hold_note"] = "explicit_pause_term"

    if source_country:
        field_confidence["source_country"] = 0.95
        field_evidence["source_country"] = "explicit_document_country_marker"
    if not wirkstoff:
        review_reasons.append("active_ingredient_requires_confirmation")
    if not wirkstoff and not handelsname:
        review_reasons.append("medication_name_requires_confirmation")
    if paused or stopped:
        review_reasons.append("medication_lifecycle_change_requires_confirmation")
    if planned:
        review_reasons.append("planned_medication_requires_confirmation")
    if explicit_status_label and not recognized_explicit_status:
        review_reasons.append("medication_status_requires_confirmation")
    if status == "aktiv" and not explicit_active:
        review_reasons.append("medication_active_status_requires_confirmation")
    if paused and hold_until is None:
        review_reasons.append("hold_end_requires_confirmation")
    if paused and stopped:
        review_reasons.append("conflicting_medication_status")
    review_reasons = list(dict.fromkeys(review_reasons))
    auto_select = bool(wirkstoff and not review_reasons and status == "aktiv")

    return {
        "raw_text": raw_text,
        "wirkstoff": wirkstoff,
        "handelsname": handelsname or "",
        "staerke": strength,
        "form": form,
        "einnahmeform": route,
        **doses,
        "einheit": einheit,
        "hinweis": hinweis,
        "grund": grund,
        "verordnet_am": verordnet_am,
        "einnahme_von": einnahme_von,
        "einnahme_bis": einnahme_bis,
        "source_date": normalized_source_date or raw_date,
        "status": status,
        "on_hold": on_hold,
        "hold_from": hold_from,
        "hold_until": hold_until,
        "hold_note": hold_note,
        "category": "besondere" if as_needed else "dauer",
        "as_needed": as_needed,
        "source_country": source_country,
        "identifiers": identifiers,
        "assertion": assertion,
        "semantic_role": "medication",
        "field_confidence": field_confidence,
        "field_evidence": field_evidence,
        "auto_select": auto_select,
        "review_reasons": review_reasons,
    }


def _clean_optional(value: str | None) -> str | None:
    compact = " ".join((value or "").split()).strip(" ,;")
    return compact or None


def _canonical_medication_route(value: str | None) -> str | None:
    compact = _clean_optional(value)
    if compact is None:
        return None
    key = re.sub(r"[^a-z]", "", compact.casefold())
    return {
        "po": "oral",
        "oral": "oral",
        "iv": "intravenös",
        "intravenos": "intravenös",
        "intravenoes": "intravenös",
        "sc": "subkutan",
        "subkutan": "subkutan",
        "im": "intramuskulär",
        "intramuskular": "intramuskulär",
        "intramuskulaer": "intramuskulär",
    }.get(key, compact)


def _medication_names(
    raw_text: str,
    structured: dict[str, str],
) -> tuple[str | None, str | None, dict[str, float], dict[str, str]]:
    confidence: dict[str, float] = {}
    evidence: dict[str, str] = {}
    wirkstoff = _trim_medication_name(structured.get("wirkstoff"))
    structured_trade = re.sub(
        r"^\s*z\.?\s*B\.?\s*",
        "",
        structured.get("handelsname", ""),
        flags=re.IGNORECASE,
    )
    handelsname = _trim_medication_name(structured_trade)
    if wirkstoff:
        confidence["wirkstoff"] = 0.98
        evidence["wirkstoff"] = "labeled_table_cell"
    if handelsname:
        confidence["handelsname"] = 0.98
        evidence["handelsname"] = "labeled_table_cell"

    explicit_ingredient = _trim_medication_name(
        _labeled_medication_text(raw_text, "Wirkstoff")
    )
    explicit_trade = _trim_medication_name(
        _labeled_medication_text(raw_text, "Handelsname|Pr[aä]parat")
    )
    if wirkstoff is None and explicit_ingredient:
        wirkstoff = explicit_ingredient
        confidence["wirkstoff"] = 0.97
        evidence["wirkstoff"] = "explicit_wirkstoff_label"
    if handelsname is None and explicit_trade:
        handelsname = explicit_trade
        confidence["handelsname"] = 0.97
        evidence["handelsname"] = "explicit_trade_name_label"

    if wirkstoff is None:
        example_brand = re.match(
            r"^\s*(?:neu\s+)?(?P<ingredient>[A-ZÄÖÜ][^(),;]{1,120}?)\s*"
            r"\(\s*z\.?\s*B\.?\s*(?P<trade>[^)]{2,100})\)",
            raw_text,
            re.IGNORECASE,
        )
        if example_brand:
            wirkstoff = _trim_medication_name(example_brand.group("ingredient"))
            handelsname = _trim_medication_name(example_brand.group("trade"))
            confidence.update({"wirkstoff": 0.96, "handelsname": 0.95})
            evidence.update(
                {
                    "wirkstoff": "active_ingredient_before_example_brand",
                    "handelsname": "example_brand_in_parentheses",
                }
            )

    if wirkstoff is None:
        parenthetical = re.match(
            r"^\s*(?:neu\s+)?(?P<trade>[A-ZÄÖÜ][^(),;]{1,100}?)\s*"
            r"\((?P<ingredient>[^)]{2,80})\)",
            raw_text,
            re.IGNORECASE,
        )
        if parenthetical and not re.search(
            r"\b(?:retard|bei\s+Bedarf|morgens|abends|Tablette|Kapsel|forte)\b",
            parenthetical.group("ingredient"),
            re.IGNORECASE,
        ):
            handelsname = _clean_optional(parenthetical.group("trade"))
            wirkstoff = _clean_optional(parenthetical.group("ingredient"))
            confidence.update({"wirkstoff": 0.93, "handelsname": 0.92})
            evidence.update(
                {
                    "wirkstoff": "parenthetical_active_ingredient",
                    "handelsname": "product_name_before_parenthetical_ingredient",
                }
            )

    if handelsname is None and wirkstoff is None:
        cleaned = re.sub(r"^\s*(?:neu\s+|MED\s+Medikamente\s*:\s*)", "", raw_text, flags=re.IGNORECASE)
        cleaned = re.sub(r"^(?:abgesetzt|pausiert|beendet|gestoppt)\s*[:\-]?\s*", "", cleaned, flags=re.IGNORECASE)
        marker_positions = [
            match.start()
            for pattern in (
                MEDICATION_STRENGTH_RE,
                MEDICATION_SCHEDULE_RE,
                MEDICATION_PRN_RE,
                MEDICATION_PZN_RE,
                MEDICATION_ATC_RE,
                MEDICATION_STOPPED_RE,
                MEDICATION_PAUSED_RE,
            )
            for match in [pattern.search(cleaned)]
            if match
        ]
        for form_pattern, _, _ in MEDICATION_FORM_PATTERNS:
            match = form_pattern.search(cleaned)
            if match:
                marker_positions.append(match.start())
        head = cleaned[: min(marker_positions)] if marker_positions else cleaned
        head = re.sub(r"\b(?:verordnet|seit|ab|bis)\s+\d{1,2}\.\d{1,2}\.\d{2,4}.*$", "", head, flags=re.IGNORECASE)
        handelsname = _clean_optional(head.strip(" :-"))
        if handelsname:
            confidence["handelsname"] = 0.82
            evidence["handelsname"] = "unlabeled_leading_product_text"
    return wirkstoff, handelsname, confidence, evidence


def _trim_medication_name(value: str | None) -> str | None:
    if not value:
        return None
    marker_positions = [
        match.start()
        for pattern in (
            MEDICATION_STRENGTH_RE,
            MEDICATION_SCHEDULE_RE,
            MEDICATION_PZN_RE,
            MEDICATION_ATC_RE,
            re.compile(
                r"\b(?:verordnet|Einnahmebeginn|Beginn|Start|seit|abgesetzt|pausiert)\b",
                re.IGNORECASE,
            ),
        )
        for match in [pattern.search(value)]
        if match
    ]
    for form_pattern, _, _ in MEDICATION_FORM_PATTERNS:
        form_match = form_pattern.search(value)
        if form_match:
            marker_positions.append(form_match.start())
    trimmed = value[: min(marker_positions)] if marker_positions else value
    return _clean_optional(trimmed.strip(" ,-"))


def _labeled_medication_text(raw_text: str, label_pattern: str) -> str | None:
    match = re.search(
        rf"\b(?:{label_pattern})\s*[:=]\s*(?P<value>.+?)"
        r"(?=\s*[,;]\s*(?:Wirkstoff|Handelsname|Pr[aä]parat|Hinweis|Anweisung|Grund|Indikation)\s*[:=]|$)",
        raw_text,
        re.IGNORECASE,
    )
    return _clean_optional(match.group("value")) if match else None


def _normalize_medication_date(raw_date: str | None) -> str | None:
    if not raw_date:
        return None
    iso_match = re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_date.strip())
    if iso_match:
        return raw_date.strip()
    return _normalize_german_date(raw_date.strip())


def _medication_date_after(raw_text: str, prefix_pattern: str) -> str | None:
    match = re.search(
        rf"{prefix_pattern}\s*[:\-]?\s*(?P<date>\d{{1,2}}\.\d{{1,2}}\.(?:\d{{4}}|\d{{2}}))\b",
        raw_text,
        re.IGNORECASE,
    )
    return _normalize_german_date(match.group("date")) if match else None


def _split_medication_items(value: str) -> list[str]:
    cleaned = re.sub(r"^\s*(?:neu\s+|MED\s+Medikamente\s*:\s*)", "", value, flags=re.IGNORECASE)
    boundary = re.compile(
        r"[,;]\s+(?!(?:Einnahmebeginn|Beginn|Start|Verordnet|ATC|PZN|Wirkstoff|"
        r"Handelsname|Präparat|Hinweis|Anweisung|Grund|Indikation|Kontrolle)\b)"
        r"(?=[A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9®+./-]*"
        r"(?:\s+\([^)]{1,80}\))?(?:\s+(?:\d|[A-ZÄÖÜ])|\s*$))"
    )
    return [item.strip(" ,") for item in boundary.split(cleaned) if item.strip(" ,")]


def _has_medication_dose_pattern(value: str) -> bool:
    return bool(MEDICATION_STRENGTH_RE.search(value) or MEDICATION_SCHEDULE_RE.search(value))


def _chronology_candidates(section: Section) -> list[ClinicalCandidate]:
    repaired = _repair_wrapped_date_lines(
        list(zip(section.text.splitlines(), section.line_pages, strict=False))
    )
    events: list[tuple[str, list[str], int | None]] = []
    current_date: str | None = None
    current_lines: list[str] = []
    current_page: int | None = section.page
    preamble: list[str] = []

    def flush() -> None:
        nonlocal current_date, current_lines, current_page
        if current_date and any(line.strip() for line in current_lines):
            events.append((current_date, list(current_lines), current_page))
        current_date = None
        current_lines = []

    for line, page in repaired:
        match = DATE_AT_START_RE.match(line)
        if match:
            if current_date and current_lines and re.search(
                r"\b(?:seit\s+dem|vom|am|ab|bis\s+zum)\s*$",
                current_lines[-1],
                re.IGNORECASE,
            ):
                current_lines.append(line.strip())
                continue
            flush()
            current_date = match.group("date")
            current_page = page
            if match.group("text").strip():
                current_lines.append(match.group("text").strip())
        elif current_date:
            current_lines.append(line.strip())
        elif line.strip():
            preamble.append(line.strip())
    flush()

    candidates: list[ClinicalCandidate] = []
    if preamble:
        preamble_section = replace(section, text="\n".join(preamble))
        candidate = _section_candidate(preamble_section)
        if candidate:
            candidates.append(candidate)
    for raw_date, lines, page in events:
        result = "\n".join(lines).strip()
        normalized_date = _normalize_german_date(raw_date)
        event_section = replace(
            section,
            heading=f"{section.heading} {raw_date}",
            text=result,
            page=page,
            line_pages=[],
        )
        candidates.append(
            _candidate(
                "examination",
                result,
                {
                    "title": section.heading,
                    "result": result,
                    "status": "final",
                    "kind": "other",
                    "section_role": "chronology",
                    "date": normalized_date or raw_date,
                    "assertion": "documented",
                    "semantic_role": "chronology_event",
                    "auto_select": True,
                    "review_reasons": [],
                },
                event_section,
                ("recognized_heading", "specific_section_role", "structured_date"),
            )
        )
    if candidates:
        return candidates
    fallback = _section_candidate(section)
    return [fallback] if fallback else []


def _repair_wrapped_date_lines(lines: list[tuple[str, int]]) -> list[tuple[str, int]]:
    repaired: list[tuple[str, int]] = []
    index = 0
    while index < len(lines):
        line, page = lines[index]
        match = WRAPPED_DATE_RE.match(line)
        if match and index + 1 < len(lines):
            next_line, _ = lines[index + 1]
            continuation = re.match(r"^\s*(?P<digit>\d)(?:\s+(?P<remainder>.*))?$", next_line)
            if continuation:
                suffix = match.group("text") or ""
                remainder = continuation.group("remainder") or ""
                repaired.append(
                    (
                        f"{match.group('prefix')}{match.group('year')}"
                        f"{continuation.group('digit')}{suffix}"
                        f"{' ' + remainder if remainder else ''}",
                        page,
                    )
                )
                index += 2
                continue
        repaired.append((line, page))
        index += 1
    return repaired


def _normalize_german_date(value: str) -> str | None:
    match = re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})", value.strip())
    if not match:
        return None
    day, month, year = (int(part) for part in match.groups())
    if year < 100:
        year += 2000 if year < 70 else 1900
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _find_section_line(lines: list[str], prefix: str) -> int | None:
    normalized_prefix = " ".join(prefix.casefold().split())
    for index, line in enumerate(lines):
        normalized = " ".join(line.casefold().split())
        if normalized.startswith(normalized_prefix):
            return index
    return None


def _section_slice(
    section: Section,
    start: int,
    end: int,
    *,
    target: Target,
    heading: str,
) -> Section | None:
    lines = section.text.splitlines()[start:end]
    if not any(line.strip() for line in lines):
        return None
    pages = section.line_pages[start:end]
    return Section(
        target=target,
        heading=heading,
        text="\n".join(lines).strip(),
        page=next((page for page in pages if page is not None), section.page),
        line_pages=list(pages),
    )


def _oncology_assessment_candidates(
    section: Section,
) -> tuple[list[ClinicalCandidate], list[str]]:
    """Split a long oncology assessment into patient facts and education.

    Multi-page oncology letters often place literature background and a generic
    checkpoint-inhibitor adverse-effect catalogue between the actual assessment
    and the current plan. That catalogue remains available in ``raw_text`` but
    must not become patient diagnoses or one enormous recommendation candidate.
    """

    lines = section.text.splitlines()
    treatment = _find_section_line(lines, "Für die weitere Behandlung")
    education = _find_section_line(lines, "Die Europäische Kommission")
    safety = _find_section_line(lines, "Wichtig ist eine rasche medizinische Behandlung")
    current = _find_section_line(lines, "Aktuell haben wir")
    plan = _find_section_line(lines, "Prinzipiell ist eine Rektumresektion")

    boundaries = [index for index in (treatment, education, safety, current, plan) if index is not None]
    if not boundaries:
        fallback = _section_candidate(section)
        return ([fallback] if fallback else []), []

    candidates: list[ClinicalCandidate] = []

    assessment_end = treatment if treatment is not None else min(boundaries)
    assessment = _section_slice(
        section,
        0,
        assessment_end,
        target="examination",
        heading="Zusammenfassende Beurteilung",
    )
    if assessment:
        candidates.append(
            _candidate(
                "examination",
                assessment.text,
                {
                    "title": assessment.heading,
                    "result": assessment.text,
                    "status": "final",
                    "kind": "other",
                    "section_role": "assessment",
                    "assertion": "documented",
                    "semantic_role": "assessment",
                    "auto_select": True,
                    "review_reasons": [],
                },
                assessment,
                ("recognized_heading", "section_body", "specific_section_role"),
            )
        )

    if treatment is not None:
        treatment_end = education if education is not None else (safety or current or plan or len(lines))
        treatment_section = _section_slice(
            section,
            treatment,
            treatment_end,
            target="recommendation",
            heading="Therapiebegründung",
        )
        if treatment_section:
            candidates.append(
                _candidate(
                    "recommendation",
                    treatment_section.text,
                    {
                        "description": treatment_section.text,
                        "section_role": "treatment_recommendation",
                        "assertion": "recommended",
                        "semantic_role": "treatment_recommendation",
                        "auto_select": True,
                        "review_reasons": [],
                    },
                    treatment_section,
                    ("recognized_heading", "section_body", "specific_section_role"),
                )
            )

    if safety is not None:
        safety_end = current if current is not None else (plan or len(lines))
        safety_section = _section_slice(
            section,
            safety,
            safety_end,
            target="recommendation",
            heading="Sicherheitshinweis",
        )
        if safety_section:
            candidates.append(
                _candidate(
                    "recommendation",
                    safety_section.text,
                    {
                        "description": safety_section.text,
                        "section_role": "patient_safety_instruction",
                        "assertion": "recommended",
                        "semantic_role": "patient_safety_instruction",
                        "auto_select": True,
                        "review_reasons": [],
                    },
                    safety_section,
                    ("recognized_heading", "section_body", "specific_section_role"),
                )
            )

    if current is not None:
        current_end = plan if plan is not None else len(lines)
        current_section = _section_slice(
            section,
            current,
            current_end,
            target="examination",
            heading="Aktuelles Restaging",
        )
        if current_section:
            candidates.append(
                _candidate(
                    "examination",
                    current_section.text,
                    {
                        "title": current_section.heading,
                        "result": current_section.text,
                        "status": "final",
                        "kind": "other",
                        "section_role": "current_finding",
                        "assertion": "documented",
                        "semantic_role": "current_finding",
                        "auto_select": True,
                        "review_reasons": [],
                    },
                    current_section,
                    ("recognized_heading", "section_body", "specific_section_role"),
                )
            )

    if plan is not None:
        plan_section = _section_slice(
            section,
            plan,
            len(lines),
            target="recommendation",
            heading="Weiteres Procedere",
        )
        if plan_section:
            candidates.append(
                _candidate(
                    "recommendation",
                    plan_section.text,
                    {
                        "description": plan_section.text,
                        "section_role": "treatment_plan",
                        "assertion": "recommended",
                        "semantic_role": "treatment_plan",
                        "auto_select": True,
                        "review_reasons": [],
                    },
                    plan_section,
                    ("recognized_heading", "section_body", "specific_section_role"),
                )
            )

    warnings = []
    if education is not None and (safety is not None or current is not None):
        warnings.append(
            "Generic treatment education and adverse-effect catalogue were kept in raw text "
            "but not proposed as patient clinical facts."
        )
    return candidates, warnings


def _radiology_diagnosis_candidates(section: Section) -> list[ClinicalCandidate]:
    rows: list[ClinicalCandidate] = []
    for statement in _split_clinical_statements(section.text):
        value = _strip_row_prefix(statement)
        if (
            not value
            or len(value) < 3
            or _is_negative_assessment(value)
            or _is_non_diagnostic_assessment(value)
        ):
            continue
        semantics = _diagnosis_semantics(value)
        if semantics.target != "diagnosis":
            continue
        rows.append(
            _candidate(
                "diagnosis",
                value,
                {
                    "label": value,
                    "kind": "secondary",
                    "certainty": semantics.certainty,
                    "source_mode": "extern",
                    "assertion": semantics.assertion,
                    "semantic_role": "diagnosis",
                    "auto_select": semantics.auto_select,
                    "review_reasons": list(semantics.review_reasons),
                },
                section,
                (
                    "recognized_heading",
                    "radiology_impression",
                    "explicit_suspicion"
                    if semantics.assertion == "suspected"
                    else "explicit_positive_context",
                    *(semantics.confidence_signals[-1:] if semantics.review_reasons else ()),
                ),
            )
        )
    return rows


def _split_clinical_statements(text: str) -> list[str]:
    statements: list[str] = []
    joined = " ".join(line.strip() for line in text.splitlines() if line.strip())
    for sentence in re.split(r"(?<=[.!?])\s+(?=[A-ZÄÖÜ])", joined):
        for clause in re.split(r"\s+(?:jedoch|aber)\s+", sentence, flags=re.IGNORECASE):
            if clause.strip():
                statements.append(clause.strip())
    return statements


def _is_non_diagnostic_assessment(value: str) -> bool:
    return bool(
        re.search(
            r"\b(?:zufriedenstellend(?:e[rsnm]?)?\s+verlauf|digital\s+erstellt|"
            r"ohne\s+unterschrift\s+gültig|bilddaten\s+werden|langfristig\s+elektronisch)\b",
            value,
            re.IGNORECASE,
        )
    )


def _section_candidate(section: Section) -> ClinicalCandidate | None:
    value = _normalize_section_body(section.text)
    if not value:
        return None
    role = _section_role(section.heading)
    normalized: dict[str, Any]
    if section.target == "anamnesis":
        assertion = {
            "family_history": "family_history",
            "personal_history": "historical",
        }.get(role, "documented")
        normalized = {
            "anamnese_aktuelle": value,
            "section_role": role,
            "assertion": assertion,
            "semantic_role": role if role != "section" else "anamnesis",
            "auto_select": True,
            "review_reasons": [],
        }
    elif section.target == "examination":
        normalized = {
            "title": section.heading,
            "result": value,
            "status": "final",
            "kind": "other",
            "section_role": role,
            "assertion": "documented",
            "semantic_role": role if role != "section" else "examination",
            "auto_select": True,
            "review_reasons": [],
        }
    else:
        normalized = {
            "description": value,
            "section_role": role,
            "assertion": "documented",
            "semantic_role": role if role != "section" else section.target,
            "auto_select": True,
            "review_reasons": [],
        }
    return _candidate(
        section.target,
        value,
        normalized,
        section,
        ("recognized_heading", "section_body", "specific_section_role"),
    )


def _normalize_section_body(text: str) -> str:
    value = ""
    for line in (
        _repair_native_pdf_spacing_artifacts(" ".join(line.split()))
        for line in text.splitlines()
        if line.strip()
    ):
        if value.endswith("-") and line[:1].islower():
            value = f"{value[:-1]}{line}"
        else:
            value = f"{value}\n{line}".strip()
    return value


def _repair_native_pdf_spacing_artifacts(text: str) -> str:
    """Repair only allowlisted kerning splits seen in otherwise-good PDF text layers.

    A broad "join adjacent tokens" rule would corrupt genuine prose. These
    patterns therefore cover deterministic date formatting and a small set of
    common German radiology words whose glyph runs are often split by embedded
    font positioning.
    """

    text = re.sub(r"\b(\d{2})\s*/\s*(\d{2})\s+(\d{2})\b", r"\1/\2\3", text)
    text = re.sub(
        r"\b(Colon|Rektum)\s*-\s*(Ca)\b",
        r"\1-\2",
        text,
        flags=re.IGNORECASE,
    )
    repairs = (
        (r"\bm\s+it\b", "mit"),
        (r"\bD\s+arstellung\b", "Darstellung"),
        (r"\bparenchymatö\s+se\b", "parenchymatöse"),
        (r"\blympho\s+gene\b", "lymphogene"),
    )
    for pattern, replacement in repairs:
        text = re.sub(pattern, replacement, text)
    return text
