"""Sentence boundaries for a sentence-trained translation model."""
from __future__ import annotations

import re
import textwrap


def number_matches(text: str) -> list[re.Match[str]]:
    # A hyphen following a number/percent is a range separator, not the sign
    # of its upper bound. Standalone negative/positive values keep their sign.
    return list(re.finditer(r"(?<![\d%])[+\-−]?\d+(?:[.,]\d+)*", text))


def repair_untranslated_terms(source: str, translated: str, terms: dict[str, str]) -> str:
    """Replace a glossary phrase only if it survives untranslated from source.

    Whole-phrase boundaries and source evidence prevent changing names, adding
    absent procedures, or silently repairing a different translated assertion.
    The parent still checks numbers and clinical qualifiers after this step.
    """
    for original, german in sorted(terms.items(), key=lambda item: -len(item[0])):
        pattern = r"(?<!\w)" + re.escape(original).replace(r"\ ", r"\s+") + r"(?!\w)"
        if re.search(pattern, source, re.I):
            translated = re.sub(pattern, lambda _: german, translated, flags=re.I)
    return translated


def repair_medical_term_renderings(source: str, translated: str, repairs: list[dict[str, str]]) -> str:
    """Apply reviewed terminology corrections to exact source/target pairs.

    These pairs correct documented lexical model errors, not missing clinical
    facts. Variants outside the glossary remain subject to qualifier checks.
    """
    for term in repairs:
        original = r"(?<!\w)" + re.escape(term["source"]).replace(r"\ ", r"\s+") + r"(?!\w)"
        if re.search(original, source, re.I):
            target = r"(?<!\w)" + re.escape(term["translated"]) + r"(?!\w)"
            translated = re.sub(target, lambda _: term["german"], translated, flags=re.I)
    return translated


def reflow_translation_text(text: str, headings: set[str]) -> str:
    """Join wrapped prose within a page while retaining tables and list rows."""
    pages: list[str] = []
    for page in text.split("\f"):
        output: list[str] = []
        pending: list[str] = []
        in_diagnoses = False

        def flush() -> None:
            if pending:
                output.append(" ".join(pending))
                pending.clear()

        for raw in page.split("\n"):
            line = raw.strip()
            key = line.rstrip(":,").casefold()
            if not line or "\t" in raw or key in headings or line.startswith(("<", "/<")):
                flush()
                output.append(raw if "\t" in raw else line)
                if key in headings:
                    in_diagnoses = "diagnos" in key
                continue
            if re.match(r"(?:Dr\.|Prof\.|Tel\.|Fax\s*[:.]|E-Mail\s*:)", line) or "@" in line:
                flush()
                output.append(line)
                continue
            if pending and in_diagnoses and line[:1].isupper() and not pending[-1].endswith((",", "-", " with", " of", " and")):
                flush()
            if re.match(r"^(?:[-*•]|\d+[.)])\s+", line):
                flush()
            pending.append(line)
        flush()
        pages.append("\n".join(output))
    return "\f".join(pages)


def restore_decimal_spelling(source: str, translated: str) -> str:
    """Restore literal source decimals after unambiguous dot/comma localization.

    English comma-grouped thousands can also localize to German dot groups.
    A source dot followed by three digits remains ambiguous and is not repaired.
    Changed digits, reordered numbers and changed signs are never repaired.
    """
    original = number_matches(source)
    target = number_matches(translated)
    if len(original) != len(target):
        return translated
    for before, after in zip(original, target, strict=True):
        left, right = before.group(), after.group()
        if left == right:
            continue
        decimal = (re.fullmatch(r"[+-]?\d+\.\d+", left) and right == left.replace(".", ",")
                   and len(left.rsplit(".", 1)[1]) != 3)
        thousands = (re.fullmatch(r"[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?", left)
                     and right == left.translate(str.maketrans(',.', '.,')))
        if not (decimal or thousands):
            return translated
    for before, after in reversed(list(zip(original, target, strict=True))):
        translated = translated[:after.start()] + before.group() + translated[after.end():]
    return translated


def sentence_chunks(text: str) -> list[str]:
    # Sentence-level inference prevents the model from returning only the first
    # sentence of a paragraph. Keep decimals, domains, initials and titles.
    boundaries = re.finditer(r"(?<=[.!?])\s+(?=[A-Z\"“])", text)
    sentences: list[str] = []
    start = 0
    for boundary in boundaries:
        previous = text[start:boundary.start()]
        if re.search(r"(?:\b(?:Dr|Mr|Mrs|Ms|Prof|St|vs|etc)|\b[A-Z]|\b[IVX]+|\be\.g|\bi\.e)\.$", previous):
            continue
        sentences.append(previous)
        start = boundary.end()
    sentences.append(text[start:])
    return [chunk for sentence in sentences for chunk in textwrap.wrap(
        sentence, width=700, break_long_words=False, break_on_hyphens=False,
    )]
