"""Local English → German review drafts. Source facts are never replaced."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys

from .models import DraftTranslation, ParseDraft
from .translation_segments import number_matches

MODEL_ID = "argos-en_de-1.3"
MODEL_DIRECTORY = Path(os.getenv(
    "PARSER_TRANSLATION_MODEL_DIR",
    str(Path(__file__).resolve().parent.parent / "models" / "translate-en_de-1_3"),
))
MAX_TRANSLATION_CHARS = 60_000
MAX_TRANSLATION_OUTPUT_CHARS = 180_000
TRANSLATION_TIMEOUT_SECONDS = 120


def clinical_qualifiers_preserved(source: str, translated: str) -> bool:
    # Conservative omission checks for qualifiers with supported German
    # equivalents. This is not semantic validation; every draft needs review.
    qualifiers = (
        (r"\beuthyroid\b", r"\beuthyr(?:oid|eot|eos)\w*\b"),
        (r"\bhypothyroid(?:ism)?\b", r"\b(?:hypothyr\w*|Schilddrüsenunterfunktion)\b"),
        (r"\bhyperthyroid(?:ism)?\b", r"\b(?:hyperthyr\w*|Schilddrüsenüberfunktion)\b"),
        (r"\bbenign\b", r"\b(?:benign\w*|gutartig\w*)\b"),
        (r"\bmalignant\b", r"\b(?:malign\w*|bösartig\w*)\b"),
        (r"\bsuspected\b", r"\b(?:Verdacht\w*|vermut\w*|suspekt\w*)\b"),
        (r"\bstatus\s+post\b", r"\b(?:Zustand\s+nach|Status\s+(?:post|nach)|Z\.?\s*n\.?)\b"),
        (r"\b(?:exclusion\s+of|rule\s+out)\b", r"\bAusschluss\w*\b"),
        (r"\bright\b", r"\b(?:rechts\w*|rechte[rsnm]?)\b"),
        (r"\bleft\b", r"\b(?:links\w*|linke[rsnm]?)\b"),
        (r"\bbilateral(?:ly)?\b", r"\b(?:bilateral\w*|beidseit\w*)\b"),
        (r"\bascending\s+colon\b", r"\b(?:(?:Colon|Kolon)\s+ascendens|aufsteigend\w*\s+(?:Dickdarm|Kolon))\b"),
        (r"\bsolitary\b", r"\b(?:solitär\w*|einzeln\w*)\b"),
    )
    source_negations = len(re.findall(
        r"\b(?:no|not|without|excluded|unremarkable)\b", source, re.I
    ))
    german_negations = len(re.findall(
        r"\b(?:nicht|kein\w*|ohne|ausgeschlossen\w*|unauffällig\w*)\b", translated, re.I
    ))
    if source_negations != german_negations:
        return False
    return all(
        len(re.findall(original, source, re.IGNORECASE))
        <= len(re.findall(german, translated, re.IGNORECASE))
        for original, german in qualifiers
    )


def numbers_preserved(source: str, translated: str) -> bool:
    # The runtime restores only unambiguous decimal localization. Any remaining
    # number change needs review, including ambiguous decimal/thousands groups.
    return [m.group().replace('−', '-') for m in number_matches(source)] == [
        m.group().replace('−', '-') for m in number_matches(translated)
    ]


def with_german_translation(draft: ParseDraft) -> ParseDraft:
    if draft.source_language != "en":
        return draft
    result = draft.model_copy(deep=True)
    translation = DraftTranslation(status="unavailable", model=MODEL_ID)
    result.translation = translation
    if len(draft.raw_text) + sum(len(item.value) for item in draft.candidates) > MAX_TRANSLATION_CHARS:
        translation.status = "too_large"
        return result
    if not (MODEL_DIRECTORY / "model" / "model.bin").is_file():
        return result
    # The killable child bounds native inference and suppresses all library
    # diagnostics. Only the JSON review draft crosses back to the queue worker.
    request = {"text": draft.raw_text, "candidates": {item.id: item.value for item in draft.candidates}}
    try:
        completed = subprocess.run(
            [sys.executable, "-m", "app.translation_runtime", str(MODEL_DIRECTORY.resolve())],
            input=json.dumps(request, ensure_ascii=True),
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", timeout=TRANSLATION_TIMEOUT_SECONDS,
            check=True, cwd=Path(__file__).resolve().parent.parent,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        if len(completed.stdout) > MAX_TRANSLATION_OUTPUT_CHARS * 6:
            raise ValueError("Translation output exceeded limit")
        payload = json.loads(completed.stdout)
        text = payload["text"]
        values = payload["candidates"]
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TRANSLATION_OUTPUT_CHARS:
            raise ValueError("Invalid translation text")
        if text.count("\f") != draft.raw_text.count("\f"):
            raise ValueError("Translation page mismatch")
        if not isinstance(values, dict) or set(values) != set(request["candidates"]):
            raise ValueError("Translation candidate mismatch")
        if any(not isinstance(value, str) or not value.strip() or len(value) > 40_000 for value in values.values()):
            raise ValueError("Invalid translation candidate")
        translation.status = "review_required"
        translation.text = text
        if not numbers_preserved(draft.raw_text, text):
            translation.warnings.append("translation_numbers_changed")
        if not clinical_qualifiers_preserved(draft.raw_text, text):
            translation.warnings.append("translation_terms_changed")
        for candidate in draft.candidates:
            value = values[candidate.id]
            if len(value.encode("utf-8")) > 20_000:
                if "translation_candidate_too_long" not in translation.warnings:
                    translation.warnings.append("translation_candidate_too_long")
            else:
                numbers_ok = numbers_preserved(candidate.value, value)
                terms_ok = clinical_qualifiers_preserved(candidate.value, value)
                if numbers_ok and terms_ok:
                    translation.candidate_values[candidate.id] = value
                for valid, warning in (
                    (numbers_ok, "translation_numbers_changed"),
                    (terms_ok, "translation_terms_changed"),
                ):
                    if not valid and warning not in translation.warnings:
                        translation.warnings.append(warning)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        # Do not persist/log model errors, which can include medical content.
        translation.status = "failed"
    return result
