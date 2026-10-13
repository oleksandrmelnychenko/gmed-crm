#!/usr/bin/env python3
"""Merge one or more EN–DE parallel CSVs into clean train/valid/test splits.

Accepts ELRC-compatible CSV columns:
  id,lang,source_text,target_text
(source_text=English, target_text=German, lang typically en-de)

Writes ONLY under --out-dir (default: training/en-de/out/merged).
Does NOT delete or modify training/en-de/out/elrc-filtered/ or models/.

Safe to run on host Python without torch.
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
    return WS_RE.sub(" ", text)


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
    if shorter == 0 or longer / shorter > max_ratio:
        return False
    return True


def write_parallel(path_en: Path, path_de: Path, pairs: list[tuple[str, str]]) -> None:
    with path_en.open("w", encoding="utf-8", newline="\n") as fe, path_de.open(
        "w", encoding="utf-8", newline="\n"
    ) as fd:
        for en, de in pairs:
            fe.write(en + "\n")
            fd.write(de + "\n")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--inputs",
        type=Path,
        nargs="+",
        required=True,
        help="One or more CSV paths (id,lang,source_text,target_text)",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "out" / "merged",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--valid-ratio", type=float, default=0.05)
    parser.add_argument("--test-ratio", type=float, default=0.05)
    parser.add_argument("--min-chars", type=int, default=12)
    parser.add_argument("--max-chars", type=int, default=800)
    parser.add_argument("--min-words", type=int, default=3)
    parser.add_argument("--max-ratio", type=float, default=2.5)
    parser.add_argument("--strip-carets", action="store_true", default=True)
    parser.add_argument("--keep-carets", action="store_true")
    parser.add_argument("--lang", default="en-de")
    args = parser.parse_args()
    if args.keep_carets:
        args.strip_carets = False

    out = args.out_dir.resolve()
    # Hard safety: refuse to write into elrc-filtered or models
    out_s = str(out).replace("\\", "/").lower()
    if out_s.endswith("/elrc-filtered") or "/elrc-filtered/" in out_s + "/":
        print("Refusing to write into elrc-filtered. Choose --out-dir .../out/merged", file=sys.stderr)
        return 2
    if "/models/translate-en_de" in out_s:
        print("Refusing to write under models/translate-en_de*.", file=sys.stderr)
        return 2

    kept: list[tuple[str, str, str, str]] = []  # id, en, de, source_file
    stats: dict = {
        "inputs": [],
        "rows_read": 0,
        "dropped_lang": 0,
        "dropped_empty": 0,
        "dropped_identical": 0,
        "dropped_length": 0,
        "dropped_duplicate": 0,
        "kept": 0,
    }
    seen: set[tuple[str, str]] = set()

    for csv_path in args.inputs:
        if not csv_path.is_file():
            print(f"CSV not found: {csv_path}", file=sys.stderr)
            return 1
        file_stats = {"path": str(csv_path), "sha256": sha256_file(csv_path), "rows_read": 0, "kept": 0}
        with csv_path.open(newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            required = {"id", "lang", "source_text", "target_text"}
            if reader.fieldnames is None or not required.issubset(set(reader.fieldnames)):
                print(f"Unexpected headers in {csv_path}: {reader.fieldnames!r}", file=sys.stderr)
                return 1
            for row in reader:
                stats["rows_read"] += 1
                file_stats["rows_read"] += 1
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
                pair_id = f"{csv_path.stem}:{row.get('id') or ''}"
                kept.append((pair_id, src, tgt, csv_path.name))
                file_stats["kept"] += 1
        stats["inputs"].append(file_stats)

    stats["kept"] = len(kept)
    rng = random.Random(args.seed)
    rng.shuffle(kept)

    n = len(kept)
    n_test = int(n * args.test_ratio)
    n_valid = int(n * args.valid_ratio)
    test = kept[:n_test]
    valid = kept[n_test : n_test + n_valid]
    train = kept[n_test + n_valid :]

    out.mkdir(parents=True, exist_ok=True)
    write_parallel(out / "train.en", out / "train.de", [(e, d) for _, e, d, _ in train])
    write_parallel(out / "valid.en", out / "valid.de", [(e, d) for _, e, d, _ in valid])
    write_parallel(out / "test.en", out / "test.de", [(e, d) for _, e, d, _ in test])

    with (out / "pairs.tsv").open("w", encoding="utf-8", newline="\n") as fh:
        fh.write("id\ten\tde\tsplit\tsource_file\n")
        for split_name, rows in (("test", test), ("valid", valid), ("train", train)):
            for pair_id, en, de, src_file in rows:
                fh.write(f"{pair_id}\t{en}\t{de}\t{split_name}\t{src_file}\n")

    stats["split"] = {"train": len(train), "valid": len(valid), "test": len(test)}
    stats["filters"] = {
        "min_chars": args.min_chars,
        "max_chars": args.max_chars,
        "min_words": args.min_words,
        "max_ratio": args.max_ratio,
        "strip_carets": args.strip_carets,
        "seed": args.seed,
    }
    stats["note"] = "Did not modify elrc-filtered or production models."
    (out / "prepare_report.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(stats, indent=2, ensure_ascii=False))
    print(f"Wrote parallel files under {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
