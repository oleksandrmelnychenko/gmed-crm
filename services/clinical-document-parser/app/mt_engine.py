"""Offline machine-translation drafts for de/ru/uk/en clinical text.

The output is a draft for human review, never a verified translation. PDF line
wraps are reflowed into paragraphs first. Names, addresses and other
``protected`` terms (plus names after titles, streets and postcodes found
automatically), every digit-bearing token, glossary terms and characters the
model vocabulary cannot encode are replaced with ``XQn`` placeholders before
inference (the OPUS-MT models copy that shape verbatim, while they rewrite
years and drop dates). A segment whose placeholders do not come back exactly
once is retried with a wider beam, then with numbers visible, then with only
names/symbols masked, and finally fully unmasked; the fallbacks copy source
number spellings back in order and count as a warning. Output never contains
the SentencePiece unknown marker "⁇" or a translated protected name: such a
segment keeps its source text.

Everything except :class:`CTranslate2Backend` is pure and unit-testable with a
fake backend. Never log source or translated text: it is medical data.
"""
from __future__ import annotations

import json
import os
import re
import textwrap
import threading
from collections import Counter, OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from .mt_models import MODELS  # noqa: F401 - re-exported registry of pinned models

LANGUAGES = ("de", "ru", "uk", "en")
MAX_SOURCE_CHARS = 100_000
DEFAULT_BEAM = 4
RETRY_BEAM = 8
MAX_SEGMENT_CHARS = 400

_ZLE_TAG = {"ru": ">>rus<<", "uk": ">>ukr<<"}


@dataclass(frozen=True)
class Hop:
    model: str
    tag: str | None = None


def route(source: str, target: str) -> list[Hop]:
    """Model hops for a language pair; ru<->uk pivots through English."""
    if source not in LANGUAGES or target not in LANGUAGES:
        raise UnsupportedLanguage(source if source not in LANGUAGES else target)
    if source == target:
        raise SameLanguage(source)
    zle = {"ru", "uk"}
    if source in zle and target in zle:
        return [Hop("zle-en"), Hop("en-zle", _ZLE_TAG[target])]
    if source in zle:
        return [Hop(f"zle-{target}")]
    if target in zle:
        return [Hop(f"{source}-zle", _ZLE_TAG[target])]
    return [Hop(f"{source}-{target}")]


class TranslationError(Exception):
    code = "translation_failed"


class UnsupportedLanguage(TranslationError):
    code = "unsupported_language"


class SameLanguage(TranslationError):
    code = "same_language"


class EmptyText(TranslationError):
    code = "empty_text"


class TooLarge(TranslationError):
    code = "too_large"


class ModelUnavailable(TranslationError):
    code = "model_unavailable"


class Backend(Protocol):
    """Translates already segmented (and masked) sentences with one model."""

    def available(self, model: str) -> bool: ...

    def translate(self, model: str, texts: list[str], tag: str | None, beam_size: int) -> list[str]: ...


# --------------------------------------------------------------------------
# Language detection
# --------------------------------------------------------------------------

_CYRILLIC = re.compile("[\u0400-\u04FF]")
_LATIN = re.compile(r"[A-Za-zÄÖÜäöüß]")
_UKRAINIAN = re.compile(r"[іїєґІЇЄҐ]")
_DE_STOP = frozenset((
    "der die das und ist nicht mit von den dem des ein eine einer eines im zu zur zum auf für bei wir "
    "sich auch nach sowie wurde wird werden am ab seit über unter oder als kein keine vom beim frau herr "
    "patientin patienten bitte"
).split())
# Words shared with German (in, an, am, so, ...) and single letters are omitted.
_EN_STOP = frozenset((
    "the and is of with to for on was were not by at this that from he she his her has have "
    "been be are there which after without due"
).split())
_GERMAN_LETTERS = re.compile(r"[äöüßÄÖÜ]")


def detect_language(text: str) -> str:
    cyrillic = len(_CYRILLIC.findall(text))
    latin = len(_LATIN.findall(text))
    if cyrillic > latin:
        return "uk" if _UKRAINIAN.search(text) else "ru"
    words = re.findall(r"[a-zäöüß]+", text.casefold())
    de = sum(word in _DE_STOP for word in words) + 2 * len(_GERMAN_LETTERS.findall(text))
    en = sum(word in _EN_STOP for word in words)
    return "en" if en > de else "de"


# --------------------------------------------------------------------------
# Glossary
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Repair:
    pattern: re.Pattern[str]
    replacement: str
    source: re.Pattern[str] | None


@dataclass(frozen=True)
class Term:
    """A German source term replaced by a fixed, reviewed target rendering.

    The term is masked like a name, so the model cannot drop or garble it; the
    rendering is inserted in its base form (grammatical case is not adapted).
    """

    pattern: re.Pattern[str]
    renderings: dict[str, str]


@dataclass(frozen=True)
class Glossary:
    abbreviations: tuple[tuple[re.Pattern[str], str], ...] = ()
    terms: tuple[Term, ...] = ()
    repairs: dict[str, tuple[Repair, ...]] = field(default_factory=dict)
    headings: tuple[Term, ...] = ()
    titles: dict[str, dict[str, str]] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "Glossary":
        data = json.loads(path.read_text(encoding="utf-8"))
        abbreviations = tuple(
            (re.compile(r"(?<![\w.])(?:" + item["pattern"] + r")(?!\w)"), item["replacement"])
            for item in data.get("de_abbreviations", []) + data.get("de_rewrites", [])
        )
        terms = tuple(
            Term(
                re.compile(r"(?<![\w.])(?:" + item["pattern"] + r")(?!\w)"),
                {language: value for language, value in item.items() if language in LANGUAGES},
            )
            for item in data.get("de_terms", [])
        )
        repairs = {
            language: tuple(
                Repair(
                    re.compile(r"(?<!\w)(?:" + item["pattern"] + r")(?!\w)", re.IGNORECASE),
                    item["replacement"],
                    re.compile(item["source"], re.IGNORECASE) if item.get("source") else None,
                )
                for item in items
            )
            for language, items in data.get("repairs", {}).items()
        }
        headings = tuple(
            Term(
                re.compile(r"(?:" + item["pattern"] + r")\s*(?P<colon>:?)", re.IGNORECASE),
                {language: value for language, value in item.items() if language in LANGUAGES},
            )
            for item in data.get("de_headings", [])
        )
        titles = {title: dict(renderings) for title, renderings in data.get("de_titles", {}).items()}
        return cls(abbreviations, terms, repairs, headings, titles)

    def title_span(self, text: str, protected: list[str], source_language: str,
                   target_language: str) -> list[tuple[int, int, str]]:
        """Sentence-initial ``Frau Muster`` -> ``Г-жа Muster``.

        At the start of a sentence the models tend to read "Frau" as the
        subject ("Жінка представила Muster ..."); mid-sentence they handle it
        and repairs fix the rendering, so only the sentence start is masked.
        """
        match = re.match(r"(Frau|Herrn?) ", text)
        if source_language != "de" or not match:
            return []
        rendering = self.titles.get(match.group(1), {}).get(target_language)
        for start, end in protected_spans(text, protected):
            if start == match.end() and rendering:
                return [(0, end, f"{rendering} {text[start:end]}")]
        return []

    def is_heading(self, line: str, source_language: str) -> bool:
        if source_language != "de":
            return False
        stripped = line.strip()
        return any(heading.pattern.fullmatch(stripped) for heading in self.headings)

    def heading(self, line: str, source_language: str, target_language: str) -> str | None:
        """Reviewed rendering of a whole-line German section heading (keeps a trailing colon)."""
        if source_language != "de":
            return None
        for heading in self.headings:
            match = heading.pattern.fullmatch(line.strip())
            rendering = heading.renderings.get(target_language)
            if match and rendering:
                return rendering + match.group("colon")
        return None

    def expand(self, text: str, source_language: str) -> str:
        """Expand German abbreviations; a final abbreviation keeps its sentence period."""
        if source_language != "de":
            return text
        for pattern, replacement in self.abbreviations:
            text = pattern.sub(
                lambda match, r=replacement: r + ("." if _ends_sentence(match) else ""), text,
            )
        return text

    def term_spans(self, text: str, source_language: str, target_language: str) -> list[tuple[int, int, str]]:
        if source_language != "de":
            return []
        spans: list[tuple[int, int, str]] = []
        for term in self.terms:
            rendering = term.renderings.get(target_language)
            if not rendering:
                continue
            for match in term.pattern.finditer(text):
                end = match.end() - 1 if _ends_sentence(match) else match.end()
                # Renderings may reuse captured groups, e.g. "Grad (\d)" -> "\1 степени".
                spans.append((match.start(), end, match.expand(rendering) if "\\" in rendering else rendering))
        return spans

    def repair(self, source: str, translated: str, target_language: str) -> str:
        for repair in self.repairs.get(target_language, ()):
            if repair.source is not None and not repair.source.search(source):
                continue
            translated = repair.pattern.sub(
                lambda match, r=repair: _keep_initial_case(
                    match.group(), match.expand(r.replacement) if "\\" in r.replacement else r.replacement),
                translated,
            )
        return translated


def _match_initial_case(source: str, translated: str) -> str:
    """Capitalize a translation whose sentence starts with a lowercase glossary rendering."""
    first_source = _LETTER_AT_START.search(source)
    first_target = _LETTER_AT_START.search(translated)
    if first_source and first_target and first_source.group(1).isupper() and first_target.group(1).islower():
        index = first_target.start(1)
        return translated[:index] + translated[index].upper() + translated[index + 1:]
    return translated


_LETTER_AT_START = re.compile(r"^[^\w]*([^\W\d_])")


def _ends_sentence(match: re.Match[str]) -> bool:
    """A matched abbreviation ending in '.' at the end of the text also ends the sentence."""
    return match.group().endswith(".") and not match.string[match.end():].strip()


def _keep_initial_case(original: str, replacement: str) -> str:
    if original[:1].isupper() and replacement[:1].islower():
        return replacement[:1].upper() + replacement[1:]
    return replacement


DEFAULT_GLOSSARY_PATH = Path(__file__).resolve().parent.parent / "rules" / "mt_glossary.json"


# --------------------------------------------------------------------------
# Masking
# --------------------------------------------------------------------------

# Whole digit-bearing tokens (dates, doses, "1-0-1", "HbA1c", "7,2") are copied
# verbatim. A trailing sentence period stays outside the token.
_DIGIT_TOKEN = re.compile(r"[^\W\d_]*(?:\d[\d.,:/\-]*\d|\d)[^\W_]*")
_NUMBER = re.compile(r"(?<!XQ)(?<!\d)(?:\d[\d.,:/\-]*\d|\d)")
_PLACEHOLDER = re.compile(r"XQ(\d+)(?!\d)")


def clean_protected(protected: list[str] | tuple[str, ...]) -> list[str]:
    """Distinct non-trivial terms, longest first so overlapping terms nest correctly."""
    terms = {term.strip() for term in protected if term and len(term.strip()) >= 2}
    return sorted(terms, key=lambda term: (-len(term), term))


def _protected_pattern(protected: list[str]) -> re.Pattern[str] | None:
    if not protected:
        return None
    alternatives = "|".join(re.escape(term) for term in protected)
    return re.compile(r"(?<!\w)(?:" + alternatives + r")(?!\w)")


def protected_spans(text: str, protected: list[str]) -> list[tuple[int, int]]:
    pattern = _protected_pattern(protected)
    return [match.span() for match in pattern.finditer(text)] if pattern else []


def mask(text: str, protected: list[str], terms: list[tuple[int, int, str]] | None = None,
         numbers: bool = True) -> tuple[str, list[str]]:
    """Replace protected terms, glossary terms and digit-bearing tokens with XQ1..XQn.

    ``values[n-1]`` is what ``XQn`` is restored to: the verbatim source for
    names and numbers, the reviewed target rendering for glossary terms.
    """
    values: list[str] = []

    def placeholder(value: str) -> str:
        values.append(value)
        return f"XQ{len(values)}"

    def gap(piece: str) -> str:
        return _DIGIT_TOKEN.sub(lambda match: placeholder(match.group()), piece) if numbers else piece

    names = protected_spans(text, protected)
    spans: list[tuple[int, int, str]] = []
    # A glossary term may contain a name (``Frau Muster`` -> ``г-жа Muster``)
    # but never cut through one.
    for start, end, rendering in sorted(terms or [], key=lambda span: (span[0], -span[1])):
        if any(not (end <= left or start >= right) for left, right, _ in spans):
            continue
        if any(not (end <= left or start >= right) and not (start <= left and right <= end) for left, right in names):
            continue
        spans.append((start, end, rendering))
    spans += [(start, end, text[start:end]) for start, end in names
              if all(end <= left or start >= right for left, right, _ in spans)]
    pieces: list[str] = []
    cursor = 0
    for start, end, value in sorted(spans):
        pieces.append(gap(text[cursor:start]))
        pieces.append(placeholder(value))
        cursor = end
    pieces.append(gap(text[cursor:]))
    return "".join(pieces), values


def placeholders_valid(translated: str, count: int) -> bool:
    found = Counter(int(number) for number in _PLACEHOLDER.findall(translated))
    return found == Counter(range(1, count + 1))


def restore(translated: str, values: list[str]) -> str:
    """Single pass; ``(?!\\d)`` keeps XQ1 from matching inside XQ12."""

    def replace(match: re.Match[str]) -> str:
        index = int(match.group(1))
        return values[index - 1] if 1 <= index <= len(values) else match.group()

    return _PLACEHOLDER.sub(replace, translated)


def repair_numbers(source: str, translated: str) -> tuple[str, bool]:
    """Copy source number spellings into the translation in order.

    Applied only when both sides contain the same count of numeric tokens and
    each pair has the same number of digits (``2016`` -> ``2026``, ``2.3`` ->
    ``2,3``), so reordered numbers are never swapped. Digits inside ``XQn``
    placeholders are ignored. Returns ``(text, repaired_or_already_equal)``.
    """
    original = [match.group() for match in _NUMBER.finditer(source)]
    target = list(_NUMBER.finditer(translated))
    if len(original) != len(target):
        return translated, False
    for value, match in zip(original, target, strict=True):
        if value != match.group() and len(re.sub(r"\D", "", value)) != len(re.sub(r"\D", "", match.group())):
            return translated, False
    for value, match in reversed(list(zip(original, target, strict=True))):
        translated = translated[:match.start()] + value + translated[match.end():]
    return translated, True


# --------------------------------------------------------------------------
# Segmentation
# --------------------------------------------------------------------------

# Line breaks, page breaks, tabs and runs of 2+ spaces (table columns) are
# layout: they are copied literally and never sent to the model.
_LINE_SEPARATOR = re.compile(r"(\n|\f|\t+| {2,})")
_BULLET = re.compile(r"^\s*(?:[•·▪◦‣∙●○■□►▸➢✓–—*-]|\d{1,2}[.)])\s+")
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?…])\s+(?=[\"“„«(\[]?[A-ZÄÖÜА-ЯЁІЇЄҐ])")
_ABBREVIATION_END = re.compile(
    r"(?:\b(?:Dr|Prof|Hr|Fr|St|Nr|ca|vs|etc|Mr|Mrs|Ms|Dipl|Med|med|Abt|Str|Tel|"
    r"г|гг|др|им|ул|д|т|с|п|проф|доц|вул|м)|\b[A-ZА-ЯЁІЇЄҐ]|\b\d{1,2}|\b[IVX]+|"
    r"\be\.g|\bi\.e|\bu\.a|\bт\.е|\bт\.д|\bт\.п)\.$"
)
_LETTER = re.compile(r"[^\W\d_]")


def split_sentences(text: str, protected: list[str] | None = None) -> list[tuple[str, str]]:
    """Return ``(sentence, following_whitespace)`` pairs that rejoin to ``text``.

    Handles Latin and Cyrillic sentence starts, skips common abbreviations,
    ordinal dates (``am 12. März``) and boundaries inside protected terms.
    Sentences longer than MAX_SEGMENT_CHARS are wrapped at spaces.
    """
    spans = protected_spans(text, protected or [])
    parts: list[tuple[str, str]] = []
    start = 0
    for boundary in _SENTENCE_BOUNDARY.finditer(text):
        previous = text[start:boundary.start()]
        if _ABBREVIATION_END.search(previous):
            continue
        if any(left < boundary.start() < right for left, right in spans):
            continue
        parts.append((previous, boundary.group()))
        start = boundary.end()
    parts.append((text[start:], ""))
    wrapped: list[tuple[str, str]] = []
    for sentence, gap in parts:
        if len(sentence) <= MAX_SEGMENT_CHARS:
            wrapped.append((sentence, gap))
            continue
        chunks = textwrap.wrap(sentence, width=MAX_SEGMENT_CHARS, break_long_words=False, break_on_hyphens=False)
        wrapped.extend((chunk, " ") for chunk in chunks[:-1])
        wrapped.append((chunks[-1], gap))
    return wrapped


@dataclass
class Segment:
    source: str          # after abbreviation expansion
    masked: str
    values: list[str]
    terms: list[tuple[int, int, str]]
    translated: str | None = None
    warning: bool = False
    lower_start: bool = False    # continues a rendered "Label:"; keep a lowercase start


_SALUTATION = re.compile(r"^(?:Sehr geehrte|Liebe[rs]?\b|Hallo\b|Guten Tag|Dear\b|Уважаем|Шановн|Дорог)", re.IGNORECASE)
_SENTENCE_END = re.compile(r"[.!?…]$")
_LINE_BREAK_HYPHEN = re.compile(r"[^\W\d_]-$")


def reflow(text: str, source_language: str, is_heading=lambda line: False) -> str:
    """Join lines that PDF extraction wrapped inside a sentence.

    Each output line is one block: a paragraph, heading, bullet item, table row
    or salutation. Blank lines and page breaks are kept. A line continues into
    the next when it does not end a sentence and the next line continues it:
    it starts lowercase, the line ends in a line-break hyphen (``fokal-`` +
    ``neurologisches`` -> ``fokal-neurologisches``), or the line is a long
    wrapped prose line (German: or ends in a lowercase word / comma).
    Headings, bullets, table rows (2+ spaces) and salutations never absorb an
    uppercase line.
    """
    pages = []
    for page in text.split("\f"):
        lines = page.split("\n")
        widths = [len(line.strip()) for line in lines if line.strip()]
        wide = max(widths, default=0)
        blocks: list[str] = []
        last = ""
        for raw in lines:
            line = raw.rstrip("\r")
            if blocks and _continues(blocks[-1], last, line, wide, source_language, is_heading):
                previous = blocks[-1].rstrip()
                glue = "" if _LINE_BREAK_HYPHEN.search(previous) else " "
                blocks[-1] = previous + glue + line.strip() + ("\r" if raw.endswith("\r") else "")
            else:
                blocks.append(raw)
            last = line.strip()
        pages.append("\n".join(_collapse_prose_spaces(block) for block in blocks))
    return "\f".join(pages)


def _collapse_prose_spaces(block: str) -> str:
    """Inside a sentence, 2+ spaces are extraction noise, not table columns."""
    if not _SENTENCE_END.search(block.rstrip()):
        return block
    lead = block[:len(block) - len(block.lstrip())]
    return lead + re.sub(r"(?<=\S) {2,}(?=\S)", " ", block[len(lead):])


# "Röntgen-Thorax vom 01.03.2017: ..." starts a new block even after a long line.
_LABEL = re.compile(r"^[A-ZÄÖÜА-ЯЁІЇЄҐ](?:(?!\.\s)[^:!?]){0,45}:(?:\s|$)")


def _continues(block: str, last: str, line: str, wide: int, source_language: str, is_heading) -> bool:
    previous = block.strip()
    current = line.strip()
    if not previous or not current or _BULLET.match(line) or is_heading(current) or is_heading(previous):
        return False
    if _SALUTATION.match(previous) and previous.endswith(","):
        return False
    if _LINE_BREAK_HYPHEN.search(previous) and current[0].isalpha():
        return True
    if current[0].islower():
        return True
    if _SENTENCE_END.search(previous) or "  " in last or "\t" in last or _LABEL.match(current):
        return False
    # The last physical line decides whether this was a wrapped prose line.
    long_line = wide >= 50 and len(last) >= 0.6 * wide
    if previous.endswith(":"):
        return long_line and current[0].isdigit()
    if previous.endswith(","):
        return True
    last_word = re.findall(r"[^\W\d_]+", last)[-1:] or [""]
    if source_language == "de" and last_word[0][:1].islower() and wide >= 50 and len(last) >= 0.4 * wide:
        return True
    return long_line and not current[0].isdigit()


# Names after titles/salutations, German street addresses and postcode + city
# are protected automatically (verbatim), in addition to the caller's list.
# Names never span a line break.
_NAME = r"(?:[A-ZÄÖÜ]\. ?)*[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?"
_TITLED_NAME = re.compile(
    r"\b(?:Frau|Herrn?|Fr\.|Hr\.|Dr\.|Prof\.|PD|Mr\.|Mrs\.|Ms\.)"
    r"(?: +(?:Dr\.|Prof\.|med\.|dent\.|rer\. ?nat\.))*"
    r" +(?!(?:Kolleg(?:in|e|en)|Doktor|Professor|Patient(?:in)?|Ober(?:arzt|ärztin)|Chef(?:arzt|ärztin))\b)"
    r"(" + _NAME + r"(?: " + _NAME + r"(?=[\s,.;:)]|$))?|[A-ZÄÖÜ]\.)"
)
_STREET = re.compile(
    r"\b[A-ZÄÖÜ][\wäöüß-]*(?:straße|strasse|str\.|weg|gasse|platz|allee|ring|damm|ufer|chaussee)"
    r" \d{1,4} ?[a-z]?\b"
)
_POSTCODE_CITY = re.compile(r"\b\d{5} [A-ZÄÖÜ][\wäöüß-]*(?:(?:am|an der|im|in der) [A-ZÄÖÜ][\wäöüß-]*)?")


def auto_protected(text: str, source_language: str) -> list[str]:
    if source_language not in ("de", "en"):
        return []
    found = {match.group(1).strip() for match in _TITLED_NAME.finditer(text)}
    found |= {match.group().strip() for match in _STREET.finditer(text)}
    found |= {match.group().strip() for match in _POSTCODE_CITY.finditer(text)}
    return sorted(found)


def symbol_pattern(symbols: set[str]) -> re.Pattern[str] | None:
    """Tokens containing characters the models cannot encode (``°C``, ``μL``, ``®``)."""
    if not symbols:
        return None
    klass = "[" + "".join(re.escape(char) for char in sorted(symbols)) + "]"
    return re.compile(r"(?:[^\W_][\w.,/]*)?(?:" + klass + r"+[^\W_]*)+")


def plan(text: str, source_language: str, target_language: str, protected: list[str],
         glossary: Glossary, symbols: re.Pattern[str] | None = None) -> tuple[list[str | Segment], list[Segment]]:
    """Split text into literal separators/whitespace and translatable segments."""
    layout: list[str | Segment] = []
    segments: list[Segment] = []
    for piece in _LINE_SEPARATOR.split(text):
        if not piece or _LINE_SEPARATOR.fullmatch(piece):
            layout.append(piece)
            continue
        stripped = piece.strip()
        if not stripped:
            layout.append(piece)
            continue
        bullet = _BULLET.match(piece)
        lead = bullet.group() if bullet else piece[:len(piece) - len(piece.lstrip())]
        stripped = piece[len(lead):].strip()
        trail = piece[len(piece.rstrip()):]
        layout.append(lead)
        heading = glossary.heading(stripped, source_language, target_language)
        if heading is not None or not stripped:
            layout.append(heading or "")
            layout.append(trail)
            continue
        expanded = _expand_outside_protected(stripped, source_language, protected, glossary)
        for sentence, gap in split_sentences(expanded, protected):
            for item in _segments(sentence, source_language, target_language, protected, glossary, symbols):
                if isinstance(item, Segment):
                    segments.append(item)
                layout.append(item)
            layout.append(gap)
        layout.append(trail)
    return layout, segments


def _segments(sentence: str, source_language: str, target_language: str, protected: list[str],
              glossary: Glossary, symbols: re.Pattern[str] | None) -> list[str | Segment]:
    terms = glossary.term_spans(sentence, source_language, target_language)
    terms += glossary.title_span(sentence, protected, source_language, target_language)
    # "Pulmo: ..." -> the rendered label is literal; the models turn a colon right
    # after a placeholder into "⁇" or drop the placeholder.
    for start, end, rendering in terms:
        label = re.match(r":\s*", sentence[end:])
        if start == 0 and label and sentence[end + label.end():].strip():
            rest = sentence[end + label.end():]
            head = _match_initial_case(sentence, rendering) + ":" + label.group()[1:]
            tail = _segments(rest, source_language, target_language, protected, glossary, symbols)
            for item in tail[:1]:
                if isinstance(item, Segment):
                    item.lower_start = rest[:1].islower()
            return [head, *tail]
    if symbols is not None:
        terms += [(match.start(), match.end(), match.group()) for match in symbols.finditer(sentence)]
    masked, values = mask(sentence, protected, terms)
    segment = Segment(sentence, masked, values, terms)
    if not _LETTER.search(_PLACEHOLDER.sub("", masked)):
        # Only names, numbers, glossary terms and punctuation.
        return [_match_initial_case(sentence, restore(masked, values))]
    return [segment]


def _expand_outside_protected(text: str, source_language: str, protected: list[str], glossary: Glossary) -> str:
    pieces: list[str] = []
    cursor = 0
    for start, end in protected_spans(text, protected):
        pieces.append(glossary.expand(text[cursor:start], source_language))
        pieces.append(text[start:end])
        cursor = end
    pieces.append(glossary.expand(text[cursor:], source_language))
    return "".join(pieces)


# --------------------------------------------------------------------------
# Engine
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class TranslationResult:
    text: str
    detected_source_language: str
    characters: int
    warnings: int


class MTEngine:
    def __init__(self, backend: Backend, glossary: Glossary | None = None) -> None:
        self.backend = backend
        self.glossary = glossary if glossary is not None else Glossary.load(DEFAULT_GLOSSARY_PATH)

    def translate(self, text: str, source_language: str | None, target_language: str,
                  protected: list[str] | tuple[str, ...] = ()) -> TranslationResult:
        if len(text) > MAX_SOURCE_CHARS:
            raise TooLarge()
        if not text.strip():
            raise EmptyText()
        if target_language not in LANGUAGES or (source_language is not None and source_language not in LANGUAGES):
            raise UnsupportedLanguage()
        source = source_language or detect_language(text)
        hops = route(source, target_language)
        for hop in hops:
            if not self.backend.available(hop.model):
                raise ModelUnavailable(hop.model)

        flowed = reflow(text, source, lambda line: self.glossary.is_heading(line, source))
        names = clean_protected(list(protected) + auto_protected(flowed, source))
        symbols = symbol_pattern(self._unencodable(hops, flowed))
        layout, segments = plan(flowed, source, target_language, names, self.glossary, symbols)
        self._translate_segments(segments, hops, names)
        for segment in segments:
            repaired = self.glossary.repair(segment.source, segment.translated or "", target_language)
            segment.translated = _match_initial_case(segment.source, repaired)
            first = re.match(r"([^\W\d_])([^\W\d_]*)", segment.translated)
            if segment.lower_start and first and first.group(1).isupper() and first.group(2).islower():
                segment.translated = segment.translated[0].lower() + segment.translated[1:]
        output = "".join(item if isinstance(item, str) else (item.translated or "") for item in layout)
        return TranslationResult(output, source, len(text), sum(segment.warning for segment in segments))

    def _unencodable(self, hops: list[Hop], text: str) -> set[str]:
        check = getattr(self.backend, "unencodable", None)
        if check is None:
            return set()
        chars = {char for char in text if not char.isspace()}
        unknown: set[str] = set()
        for hop in hops:
            unknown |= check(hop.model, chars)
        return unknown

    def _run(self, hops: list[Hop], texts: list[str], beam_size: int) -> list[str]:
        for hop in hops:
            if not texts:
                break
            texts = self.backend.translate(hop.model, texts, hop.tag, beam_size)
        return texts

    def _translate_segments(self, segments: list[Segment], hops: list[Hop], protected: list[str]) -> None:
        pending = segments
        for beam in (DEFAULT_BEAM, RETRY_BEAM):
            if not pending:
                return
            outputs = self._run(hops, [segment.masked for segment in pending], beam)
            failed: list[Segment] = []
            for segment, output in zip(pending, outputs, strict=True):
                if placeholders_valid(output, len(segment.values)) and not _has_unknown(segment.source, output):
                    segment.translated = restore(output, segment.values)
                else:
                    failed.append(segment)
            pending = failed
        if not pending:
            return
        # Fallback 1: keep names and glossary terms masked but let the model see
        # the numbers, then copy source number spellings back in order.
        light = [mask(segment.source, protected, segment.terms, numbers=False) for segment in pending]
        outputs = self._run(hops, [masked for masked, _ in light], DEFAULT_BEAM)
        remaining: list[Segment] = []
        for segment, (masked, values), output in zip(pending, light, outputs, strict=True):
            segment.warning = True
            if placeholders_valid(output, len(values)) and not _has_unknown(segment.source, output):
                segment.translated = restore(repair_numbers(masked, output)[0], values)
            else:
                remaining.append(segment)
        if not remaining:
            return
        # Fallback 2: only names and unencodable symbols masked; glossary terms
        # go to the model as words (a term placeholder can be what gets dropped).
        verbatim = [
            mask(segment.source, protected,
                 [span for span in segment.terms if segment.source[span[0]:span[1]] == span[2]], numbers=False)
            for segment in remaining
        ]
        outputs = self._run(hops, [masked for masked, _ in verbatim], DEFAULT_BEAM)
        unmasked: list[Segment] = []
        for segment, (masked, values), output in zip(remaining, verbatim, outputs, strict=True):
            if placeholders_valid(output, len(values)) and not _has_unknown(segment.source, output):
                segment.translated = restore(repair_numbers(masked, output)[0], values)
            else:
                unmasked.append(segment)
        remaining = unmasked
        if not remaining:
            return
        # Fallback 3: fully unmasked translation with the same number repair.
        outputs = self._run(hops, [segment.source for segment in remaining], DEFAULT_BEAM)
        for segment, output in zip(remaining, outputs, strict=True):
            # Never emit the SentencePiece unknown marker or a translated name:
            # keep the (reviewable) source sentence instead.
            names = [name for name in protected if name in segment.source]
            if _has_unknown(segment.source, output) or any(name not in output for name in names):
                segment.translated = segment.source
            else:
                segment.translated = repair_numbers(segment.source, output)[0]


UNKNOWN_MARK = "⁇"


def _has_unknown(source: str, output: str) -> bool:
    return UNKNOWN_MARK in output and UNKNOWN_MARK not in source


# --------------------------------------------------------------------------
# CTranslate2 backend (lazy imports: unit tests and CI do not need the models)
# --------------------------------------------------------------------------

def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except ValueError:
        return default


class CTranslate2Backend:
    """LRU of loaded OPUS-MT models converted to CTranslate2 int8.

    Each model directory holds the CT2 files plus ``source.spm`` and
    ``target.spm``. One lock per model serializes inference so CPU use stays
    bounded by ``MT_THREADS`` per loaded model.
    """

    def __init__(self, model_dir: Path | None = None, max_loaded: int | None = None, threads: int | None = None) -> None:
        self.model_dir = Path(model_dir or os.environ.get("MT_MODEL_DIR", "/app/mt-models"))
        self.max_loaded = max_loaded or _env_int("MT_MAX_LOADED_MODELS", 2)
        self.threads = threads or _env_int("MT_THREADS", 2)
        self._loaded: OrderedDict[str, tuple[object, object, object, threading.Lock]] = OrderedDict()
        self._registry_lock = threading.Lock()
        self._spm: dict[str, tuple[object, object]] = {}

    def available(self, model: str) -> bool:
        directory = self.model_dir / model
        return all((directory / name).is_file() for name in ("model.bin", "source.spm", "target.spm"))

    def _tokenizers(self, model: str) -> tuple[object, object]:
        """SentencePiece models only (small); cached independently of the LRU."""
        with self._registry_lock:
            entry = self._spm.get(model)
            if entry is None:
                import sentencepiece

                directory = self.model_dir / model
                entry = (
                    sentencepiece.SentencePieceProcessor(model_file=str(directory / "source.spm")),
                    sentencepiece.SentencePieceProcessor(model_file=str(directory / "target.spm")),
                )
                self._spm[model] = entry
            return entry

    def unencodable(self, model: str, chars: set[str]) -> set[str]:
        """Characters the model would turn into unk or change by normalization.

        Letters are checked against the source vocabulary only (the target
        vocabulary legitimately lacks the source script); symbols and digits
        must survive both, because the model copies them into the output.
        """
        source, target = self._tokenizers(model)
        unknown: set[str] = set()
        for char in chars:
            processors = (source,) if char.isalpha() else (source, target)
            for processor in processors:
                ids = processor.encode(char)
                if processor.unk_id() in ids or processor.decode(ids) != char:
                    unknown.add(char)
                    break
        return unknown

    def _get(self, model: str) -> tuple[object, object, object, threading.Lock]:
        with self._registry_lock:
            entry = self._loaded.get(model)
            if entry is not None:
                self._loaded.move_to_end(model)
                return entry
            if not self.available(model):
                raise ModelUnavailable(model)
            import ctranslate2
            import sentencepiece

            directory = self.model_dir / model
            translator = ctranslate2.Translator(
                str(directory), device="cpu", compute_type="int8",
                inter_threads=1, intra_threads=self.threads,
            )
            source = sentencepiece.SentencePieceProcessor(model_file=str(directory / "source.spm"))
            target = sentencepiece.SentencePieceProcessor(model_file=str(directory / "target.spm"))
            self._spm.setdefault(model, (source, target))
            entry = (translator, source, target, threading.Lock())
            self._loaded[model] = entry
            # An evicted model stays alive while an in-flight request holds it.
            while len(self._loaded) > self.max_loaded:
                self._loaded.popitem(last=False)
            return entry

    def translate(self, model: str, texts: list[str], tag: str | None, beam_size: int) -> list[str]:
        if not texts:
            return []
        translator, source, target, lock = self._get(model)
        prefix = [tag] if tag else []
        # "</s>" is required: without it the tc-big models repeat phrases.
        batch = [prefix + source.encode(text, out_type=str) + ["</s>"] for text in texts]
        with lock:
            results = translator.translate_batch(
                batch, beam_size=beam_size, max_batch_size=16, max_decoding_length=512,
            )
        return [target.decode(result.hypotheses[0]) for result in results]


_default_engine: MTEngine | None = None
_default_lock = threading.Lock()


def default_engine() -> MTEngine:
    global _default_engine
    with _default_lock:
        if _default_engine is None:
            _default_engine = MTEngine(CTranslate2Backend())
        return _default_engine
