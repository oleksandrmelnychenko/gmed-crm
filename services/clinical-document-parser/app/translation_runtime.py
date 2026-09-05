"""Bounded offline inference using the pinned Argos SentencePiece/CT2 model."""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

from .translation import MAX_TRANSLATION_CHARS, MAX_TRANSLATION_OUTPUT_CHARS, clinical_qualifiers_preserved, numbers_preserved
from .rules import load_rules
from .translation_segments import reflow_translation_text, repair_medical_term_renderings, repair_untranslated_terms, restore_decimal_spelling, sentence_chunks


def translate_payload(payload: dict, model_path: Path) -> dict:
    import ctranslate2
    import sentencepiece

    metadata = json.loads((model_path / "metadata.json").read_text(encoding="utf-8"))
    if (metadata.get("from_code"), metadata.get("to_code"), metadata.get("package_version")) != ("en", "de", "1.3"):
        raise ValueError("Unexpected translation model")
    tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(model_path / "sentencepiece.model"))
    engine = ctranslate2.Translator(str(model_path / "model"), device="cpu", compute_type="int8",
                                   inter_threads=1, intra_threads=2)
    cache: dict[str, str] = {}
    headings = {key.casefold(): value for key, value in load_rules()["translation_headings"].items()}
    terms = load_rules()["translation_terms"]
    term_repairs = load_rules()["translation_term_repairs"]

    def infer(chunks: list[str]) -> list[str]:
        tokens = [tokenizer.encode(chunk, out_type=str) for chunk in chunks]
        if any(len(chunk) > 512 for chunk in tokens):
            raise ValueError("Translation segment exceeded token limit")
        batches = engine.translate_batch(tokens, beam_size=4, replace_unknowns=True,
            max_batch_size=16, max_input_length=0, max_decoding_length=1024, length_penalty=0.2)
        if any(len(batch.hypotheses[0]) >= 1024 for batch in batches):
            raise ValueError("Translation output reached token limit")
        return [repair_medical_term_renderings(chunk, repair_untranslated_terms(
            chunk, restore_decimal_spelling(chunk, tokenizer.decode(batch.hypotheses[0])), terms
        ), term_repairs) for chunk, batch in zip(chunks, batches, strict=True)]

    def translate_sentence(chunk: str, translated: str) -> str:
        # One bounded retry with shorter clauses can recover qualifiers omitted
        # by the sentence model. Never insert a missing fact into model output.
        # Decimal/thousands commas are not clause boundaries. Only adopt a retry
        # when the original sentence's number and qualifier checks both pass.
        if not clinical_qualifiers_preserved(chunk, translated):
            pieces = re.split(r"([,;]\s+)", chunk)
            clauses = pieces[::2]
            if 1 < len(clauses) <= 16 and all(clauses):
                retry = infer(clauses)
                for index, value in enumerate(retry):
                    pieces[index * 2] = value.rstrip('. ') if index < len(retry) - 1 else value
                candidate = ''.join(pieces)
                if numbers_preserved(chunk, candidate) and clinical_qualifiers_preserved(chunk, candidate):
                    return candidate
        return translated

    def translate(text: str) -> str:
        # Translate complete prose sentences instead of physical PDF lines.
        # Page boundaries, table cells, headings and diagnosis rows stay distinct.
        pieces = re.split(r"([\n\f\t]+)", reflow_translation_text(text, set(headings)))
        output: list[str] = []
        for piece in pieces:
            if not piece.strip() or not re.search(r"[A-Za-z]", piece):
                output.append(piece)
                continue
            # Conventional German section titles are structural labels, not
            # inferred clinical facts. Match whole headings only.
            if heading := headings.get(piece.strip().rstrip(":,").casefold()):
                output.append(heading + (":" if piece.strip().endswith(":") else ""))
                continue
            if re.match(r"(?:Dr\.|Prof\.|Tel\.|Fax\s*[:.]|E-Mail\s*:|/<Dr\.)", piece.strip()) or "@" in piece:
                output.append(piece)
                continue
            if piece not in cache:
                chunks = sentence_chunks(piece)
                cache[piece] = " ".join(
                    translate_sentence(chunk, value)
                    for chunk, value in zip(chunks, infer(chunks), strict=True)
                )
            output.append(cache[piece])
        return "".join(output)

    result = {"text": translate(payload["text"]),
              "candidates": {key: translate(value) for key, value in payload["candidates"].items()}}
    if len(result["text"]) + sum(map(len, result["candidates"].values())) > MAX_TRANSLATION_OUTPUT_CHARS:
        raise ValueError("Translation output exceeded limit")
    return result


def main() -> None:
    # Do not print traceback or model diagnostics into the clinical job log.
    request = sys.stdin.read(MAX_TRANSLATION_CHARS * 6 + 100_000)
    payload = json.loads(request)
    if len(payload["text"]) + sum(map(len, payload["candidates"].values())) > MAX_TRANSLATION_CHARS:
        raise ValueError("Translation input exceeded limit")
    print(json.dumps(translate_payload(payload, Path(sys.argv[1])), ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.exit(1)
