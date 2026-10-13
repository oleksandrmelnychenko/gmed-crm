#!/usr/bin/env python3
"""Filter ELRC-Medical-V2 EN–DE CSV into clean parallel files for MT training.

Input CSV columns (header required):
  id,lang,source_text,target_text

Writes (under --out-dir):
  train.en / train.de, valid.en / valid.de, test.en / test.de
  pairs.tsv          (id \\t en \\t de) for provenance
  prepare_report.json

Does NOT train a model. Safe to run on host Python without torch.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import re
import sys
from pathlib import Path

CARET_RE = re.compile(r"\^\d+")
WS_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\n", " ").strip()
    text = WS_RE.sub(" ", text)
    return text


def strip_caret_markers(text: str) -> str:
    return CARET_RE.sub("", text).strip()


def length_ok(src: str, tgt: str, min_chars: int, max_chars: int, min_words: int, max_ratio: float) -> bool:
    if not (min_chars <= len(src) <= max_chars and min_chars <= len(tgt) <= max_chars):
        return False
    sw, tw = src.split(), tgt.split()
    if len(sw) < min_words or len(tw) < min_words:
        return False
    shorter = min(len(src), len(tgt))
    longer = max(len(src), len(tgt))
    if shorter == 0:
        return False
    if longer / shorter > max_ratio:
        return False
    return True


def write_parallel(path_en: Path, path_de: Path, pairs: list[tuple[str, str]]) -> None:
    with path_en.open("w", encoding="utf-8", newline="\n") as fe, path_de.open(
        "w", encoding="utf-8", newline="\n"
    ) as fd:
        for en, de in pairs:
            fe.write(en + "\n")
            fd.write(de + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "datasets" / "ELRC-Medical-V2-en-de.csv",
        help="Path to ELRC-Medical-V2-en-de.csv",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "out" / "elrc-filtered",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--valid-ratio", type=float, default=0.05)
    parser.add_argument("--test-ratio", type=float, default=0.05)
    parser.add_argument("--min-chars", type=int, default=12)
    parser.add_argument("--max-chars", type=int, default=800)
    parser.add_argument("--min-words", type=int, default=3)
    parser.add_argument("--max-ratio", type=float, default=2.5)
    parser.add_argument(
        "--strip-carets",
        action="store_true",
        default=True,
        help="Strip ^N footnote markers (default: on)",
    )
    parser.add_argument("--keep-carets", action="store_true", help="Do not strip ^N markers")
    parser.add_argument("--lang", default="en-de", help="Keep only this lang column value")
    args = parser.parse_args()
    if args.keep_carets:
        args.strip_carets = False

    if not args.csv.is_file():
        print(f"CSV not found: {args.csv}", file=sys.stderr)
        return 1

    sha = hashlib.sha256(args.csv.read_bytes()).hexdigest()
    kept: list[tuple[str, str, str]] = []  # id, en, de
    stats = {
        "input_file": str(args.csv),
        "sha256": sha,
        "rows_read": 0,
        "dropped_lang": 0,
        "dropped_empty": 0,
        "dropped_identical": 0,
        "dropped_length": 0,
        "dropped_duplicate": 0,
        "kept": 0,
    }
    seen: set[tuple[str, str]] = set()

    with args.csv.open(newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        expected = {"id", "lang", "source_text", "target_text"}
        if reader.fieldnames is None or set(reader.fieldnames) != expected:
            print(f"Unexpected CSV headers: {reader.fieldnames!r}; expected {sorted(expected)}", file=sys.stderr)
            return 1
        for row in reader:
            stats["rows_read"] += 1
            if row.get("lang", "").strip() != args.lang:
                stats["dropped_lang"] += 1
                continue
            src = normalize(row.get("source_text") or "")
            tgt = normalize(row.get("target_text") or "")
            if args.strip_carets:
                src = normalize(strip_caret_markers(src))
                tgt = normalize(strip_caret_markers(tgt))
            if not src or not tgt:
                stats["dropped_empty"] += 1
                continue
            if src == tgt:
                stats["dropped_identical"] += 1
                continue
            if not length_ok(src, tgt, args.min_chars, args.max_chars, args.min_words, args.max_ratio):
                stats["dropped_length"] += 1
                continue
            key = (src.casefold(), tgt.casefold())
            if key in seen:
                stats["dropped_duplicate"] += 1
                continue
            seen.add(key)
            kept.append((row.get("id") or "", src, tgt))

    stats["kept"] = len(kept)
    rng = random.Random(args.seed)
    rng.shuffle(kept)

    n = len(kept)
    n_test = int(n * args.test_ratio)
    n_valid = int(n * args.valid_ratio)
    test = kept[:n_test]
    valid = kept[n_test : n_test + n_valid]
    train = kept[n_test + n_valid :]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    write_parallel(args.out_dir / "train.en", args.out_dir / "train.de", [(e, d) for _, e, d in train])
    write_parallel(args.out_dir / "valid.en", args.out_dir / "valid.de", [(e, d) for _, e, d in valid])
    write_parallel(args.out_dir / "test.en", args.out_dir / "test.de", [(e, d) for _, e, d in test])

    with (args.out_dir / "pairs.tsv").open("w", encoding="utf-8", newline="\n") as fh:
        fh.write("id\ten\tde\tsplit\n")
        for split_name, rows in (("test", test), ("valid", valid), ("train", train)):
            for pair_id, en, de in rows:
                fh.write(f"{pair_id}\t{en}\t{de}\t{split_name}\n")

    stats["split"] = {"train": len(train), "valid": len(valid), "test": len(test)}
    stats["filters"] = {
        "min_chars": args.min_chars,
        "max_chars": args.max_chars,
        "min_words": args.min_words,
        "max_ratio": args.max_ratio,
        "strip_carets": args.strip_carets,
        "seed": args.seed,
    }
    report_path = args.out_dir / "prepare_report.json"
    report_path.write_text(json.dumps(stats, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(stats, indent=2, ensure_ascii=False))
    print(f"Wrote parallel files under {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
