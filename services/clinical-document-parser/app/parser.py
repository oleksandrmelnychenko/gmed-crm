from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field, replace
from datetime import date
from typing import Any

from . import PARSER_VERSION
from .models import ClinicalCandidate, ParseDraft, SourceEvidence, Target
from .rules import load_rules


SUPPORTED_TARGETS = {"diagnosis", "anamnesis", "medication", "examination", "recommendation"}
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
    clean = _normalize_text(text)
    language = _detect_language(clean)
    document_type = _detect_document_type(clean)
    sections = _split_sections(clean)
    candidates: list[ClinicalCandidate] = []
    warnings: list[str] = []

    for section in sections:
        role = _section_role(section.heading)
        if section.target == "diagnosis":
            candidates.extend(
                _diagnosis_candidates(
                    section,
                    fold_wrapped=document_type == "oncology_report",
                )
            )
        elif section.target == "medication":
            medication_rows, section_warnings = _medication_candidates(section)
            candidates.extend(medication_rows)
            warnings.extend(section_warnings)
        elif role == "chronology":
            candidates.extend(_chronology_candidates(section))
        elif document_type == "oncology_report" and role == "assessment":
            assessment_candidates, assessment_warnings = _oncology_assessment_candidates(section)
            candidates.extend(assessment_candidates)
            warnings.extend(assessment_warnings)
        else:
            candidate = _section_candidate(section)
            if candidate:
                candidates.append(candidate)
            if document_type == "radiology_report" and role == "impression":
                candidates.extend(_radiology_diagnosis_candidates(section))

    if not candidates:
        warnings.append("No supported clinical sections were recognized; manual review is required.")
    return ParseDraft(
        document_type=document_type,
        source_language=language,
        parser_version=PARSER_VERSION,
        raw_text=clean,
        candidates=candidates,
        warnings=list(dict.fromkeys(warnings)),
    )


def _normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


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
    if "onkologische diagnosen" in lowered or "nichtonkologische diagnosen" in lowered:
        return "oncology_report"
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
    if "�" in value or "\ufffd" in value:
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
    value = re.sub(r"^\s*(?:[•*\-–—]+\s*|\d+[.)]\s+)", "", line).strip()
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
        value = " ".join(part.strip() for part in current_lines if part.strip()).strip()
        if value:
            rows.append((value, current_page))
        current_lines = []
        current_page = section.page

    for index, line in enumerate(section.text.splitlines()):
        page = section.line_pages[index] if index < len(section.line_pages) else section.page
        dated = DATE_AT_START_RE.match(line)
        value = _strip_row_prefix(line)
        if not value:
            continue
        if dated or (current_lines and _looks_like_standalone_oncology_diagnosis(value)):
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


def _medication_candidates(section: Section) -> tuple[list[ClinicalCandidate], list[str]]:
    text = section.text.strip()
    if re.search(r"\b(keine|ohne)\s+(dauer)?medikation\b", text, re.IGNORECASE):
        return [], ["Medication section contains an explicit negation; no medication was proposed."]
    rows: list[ClinicalCandidate] = []
    repaired = _repair_wrapped_date_lines(
        list(zip(text.splitlines(), section.line_pages, strict=False))
    )
    entries: list[tuple[str, str | None, int | None]] = []
    current_lines: list[str] = []
    current_date: str | None = None
    current_page: int | None = section.page

    def flush() -> None:
        nonlocal current_lines, current_date, current_page
        if current_lines:
            entries.append((" ".join(current_lines).strip(), current_date, current_page))
        current_lines = []
        current_date = None
        current_page = section.page

    for line, page in repaired:
        dated = DATE_AT_START_RE.match(line)
        if dated:
            flush()
            current_date = dated.group("date")
            current_page = page
            if dated.group("text").strip():
                current_lines.append(dated.group("text").strip())
        elif current_date:
            current_lines.append(line.strip())
        elif line.strip():
            entries.append((line.strip(), None, page))
    flush()

    for entry, raw_date, page in entries:
        for value in _split_medication_items(entry):
            normalized_date = _normalize_german_date(raw_date) if raw_date else None
            rows.append(
                _candidate(
                    "medication",
                    value,
                    {
                        "wirkstoff": value,
                        "handelsname": "",
                        "category": "dauer",
                        "status": "aktiv",
                        "assertion": "active",
                        "semantic_role": "medication",
                        "auto_select": True,
                        "review_reasons": [],
                        **({"source_date": normalized_date or raw_date} if raw_date else {}),
                    },
                    _section_at_page(section, page),
                    (
                        "recognized_heading",
                        "dose_pattern" if _has_medication_dose_pattern(value) else "section_body",
                    ),
                )
            )
    return rows, []


def _split_medication_items(value: str) -> list[str]:
    cleaned = re.sub(r"^\s*(?:neu\s+|MED\s+Medikamente\s*:\s*)", "", value, flags=re.IGNORECASE)
    boundary = re.compile(
        r",\s+(?=[A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9®+./-]*"
        r"(?:\s+\([^)]{1,80}\))?\s+(?:\d|[A-ZÄÖÜ]))"
    )
    return [item.strip(" ,") for item in boundary.split(cleaned) if item.strip(" ,")]


def _has_medication_dose_pattern(value: str) -> bool:
    return bool(
        re.search(
            r"\b\d+(?:[.,]\d+)?\s*(?:mg|g|µg|mcg|ml|IE)\b|\b\d-\d-\d(?:-\d)?\b",
            value,
            re.IGNORECASE,
        )
    )


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
    value = section.text.strip()
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
