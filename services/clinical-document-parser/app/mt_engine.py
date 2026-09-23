"""Offline machine-translation drafts for de/ru/uk/en clinical text.

The output is a draft for human review, never a verified translation. Names,
addresses and other ``protected`` terms, plus every digit-bearing token, are
replaced with ``XQn`` placeholders before inference (the OPUS-MT models copy
that shape verbatim, while they rewrite years and drop dates). A segment whose
placeholders do not come back exactly once is retried with a wider beam, then
translated with only names/glossary terms masked, and finally fully unmasked;
both fallbacks copy source number spellings back in order and count as a
warning.

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

    @classmethod
    def load(cls, path: Path) -> "Glossary":
        data = json.loads(path.read_text(encoding="utf-8"))
        abbreviations = tuple(
            (re.compile(r"(?<![\w.])(?:" + item["pattern"] + r")(?!\w)"), item["replacement"])
            for item in data.get("de_abbreviations", [])
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
        return cls(abbreviations, terms, repairs)

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
                spans.append((match.start(), end, rendering))
        return spans

    def repair(self, source: str, translated: str, target_language: str) -> str:
        for repair in self.repairs.get(target_language, ()):
            if repair.source is not None and not repair.source.search(source):
                continue
            translated = repair.pattern.sub(lambda match, r=repair: _keep_initial_case(match.group(), r.replacement), translated)
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

    spans = [(start, end, text[start:end]) for start, end in protected_spans(text, protected)]
    for start, end, rendering in sorted(terms or [], key=lambda span: (span[0], -span[1])):
        if all(end <= left or start >= right for left, right, _ in spans):
            spans.append((start, end, rendering))
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

_LINE_SEPARATOR = re.compile(r"(\n|\f|\t+)")
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


def plan(text: str, source_language: str, target_language: str, protected: list[str],
         glossary: Glossary) -> tuple[list[str | Segment], list[Segment]]:
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
        lead = piece[:len(piece) - len(piece.lstrip())]
        trail = piece[len(piece.rstrip()):]
        layout.append(lead)
        expanded = _expand_outside_protected(stripped, source_language, protected, glossary)
        for sentence, gap in split_sentences(expanded, protected):
            terms = glossary.term_spans(sentence, source_language, target_language)
            masked, values = mask(sentence, protected, terms)
            segment = Segment(sentence, masked, values, terms)
            if _LETTER.search(_PLACEHOLDER.sub("", masked)):
                segments.append(segment)
            else:
                # Only names, numbers, glossary terms and punctuation.
                segment.translated = restore(masked, values)
            layout.append(segment)
            layout.append(gap)
        layout.append(trail)
    return layout, segments


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

        names = clean_protected(list(protected))
        layout, segments = plan(text, source, target_language, names, self.glossary)
        self._translate_segments(segments, hops, names)
        for segment in segments:
            repaired = self.glossary.repair(segment.source, segment.translated or "", target_language)
            segment.translated = _match_initial_case(segment.source, repaired)
        output = "".join(item if isinstance(item, str) else (item.translated or "") for item in layout)
        return TranslationResult(output, source, len(text), sum(segment.warning for segment in segments))

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
                if placeholders_valid(output, len(segment.values)):
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
            if placeholders_valid(output, len(values)):
                segment.translated = restore(repair_numbers(masked, output)[0], values)
            else:
                remaining.append(segment)
        if not remaining:
            return
        # Fallback 2: fully unmasked translation with the same number repair.
        outputs = self._run(hops, [segment.source for segment in remaining], DEFAULT_BEAM)
        for segment, output in zip(remaining, outputs, strict=True):
            segment.translated, _ = repair_numbers(segment.source, output)


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

    def available(self, model: str) -> bool:
        directory = self.model_dir / model
        return all((directory / name).is_file() for name in ("model.bin", "source.spm", "target.spm"))

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
