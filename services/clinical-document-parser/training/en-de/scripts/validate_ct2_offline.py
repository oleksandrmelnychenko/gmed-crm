#!/usr/bin/env python3
"""Smoke-test a CTranslate2 EN→DE package offline (no network).

Expected package layout (same shape as models/translate-en_de-1_3):
  <pkg>/metadata.json
  <pkg>/sentencepiece.model
  <pkg>/model/config.json
  <pkg>/model/model.bin
  <pkg>/model/shared_vocabulary.json   # or model vocabulary files

Does NOT overwrite production. Point --model-dir at a side package under
training/en-de/out/...

Requires: ctranslate2, sentencepiece (torch not required for inference).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


SAMPLES = [
    "No evidence of pneumonia.",
    "The patient denies chest pain.",
    "Blood pressure 120/80 mmHg.",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--device", default="cpu", choices=("cpu", "cuda"))
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--expect-from", default="en")
    parser.add_argument("--expect-to", default="de")
    parser.add_argument(
        "--allow-any-version",
        action="store_true",
        help="Skip package_version==1.3 check (for custom trained packages)",
    )
    args = parser.parse_args()

    meta_path = args.model_dir / "metadata.json"
    spm_path = args.model_dir / "sentencepiece.model"
    model_subdir = args.model_dir / "model"
    if not meta_path.is_file() or not spm_path.is_file() or not (model_subdir / "model.bin").is_file():
        print(f"Incomplete package under {args.model_dir}", file=sys.stderr)
        return 1

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if meta.get("from_code") != args.expect_from or meta.get("to_code") != args.expect_to:
        print(f"Unexpected language codes in metadata: {meta}", file=sys.stderr)
        return 1
    if not args.allow_any_version and meta.get("package_version") != "1.3":
        print(
            "metadata package_version is not 1.3; pass --allow-any-version for custom packages "
            "(production translation_runtime still hard-gates 1.3 unless "
            "PARSER_TRANSLATION_ALLOW_NONPINNED_MODEL=1).",
            file=sys.stderr,
        )
        return 1

    try:
        import ctranslate2
        import sentencepiece
    except ImportError as exc:
        print(f"Missing dependency: {exc}. Install ctranslate2 + sentencepiece.", file=sys.stderr)
        return 1

    tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(spm_path))
    engine = ctranslate2.Translator(
        str(model_subdir),
        device=args.device,
        compute_type=args.compute_type,
        inter_threads=1,
        intra_threads=2,
    )
    for text in SAMPLES:
        tokens = tokenizer.encode(text, out_type=str)
        out = engine.translate_batch([tokens], beam_size=4, replace_unknowns=True)
        decoded = tokenizer.decode(out[0].hypotheses[0])
        print(f"EN: {text}\nDE: {decoded}\n")
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
