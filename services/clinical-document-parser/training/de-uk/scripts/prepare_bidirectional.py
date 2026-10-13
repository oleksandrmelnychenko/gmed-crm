#!/usr/bin/env python3
"""Prepare bidirectional train/valid/test from de-X CSVs (source=de, target=X).

Writes under --out-dir:
  de2xx/{train,valid,test}.{de,xx}
  xx2de/{train,valid,test}.{xx,de}
Same bitext, swapped columns. Does NOT touch en-de or production models.
"""
from __future__ import annotations

import argparse
import csv
csv.field_size_limit(min(2**31 - 1, 10**9))
import hashlib
import json
import random
import re
import sys
from pathlib import Path

WS_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\n", " ").strip()
    return WS_RE.sub(" ", text)


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


def write_parallel(path_a: Path, path_b: Path, pairs: list[tuple[str, str]]) -> None:
    with path_a.open("w", encoding="utf-8", newline="\n") as fa, path_b.open(
        "w", encoding="utf-8", newline="\n"
    ) as fb:
        for a, b in pairs:
            fa.write(a + "\n")
            fb.write(b + "\n")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--inputs", type=Path, nargs="+", required=True)
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--src-lang", required=True, help="e.g. de")
    p.add_argument("--tgt-lang", required=True, help="e.g. uk or ru")
    p.add_argument("--lang", required=True, help="CSV lang field, e.g. de-uk")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--valid-ratio", type=float, default=0.05)
    p.add_argument("--test-ratio", type=float, default=0.05)
    p.add_argument("--min-chars", type=int, default=8)
    p.add_argument("--max-chars", type=int, default=800)
    p.add_argument("--min-words", type=int, default=2)
    p.add_argument("--max-ratio", type=float, default=2.5)
    p.add_argument("--exclude-substring", action="append", default=[], help="Skip CSV path containing this")
    args = p.parse_args()

    out = args.out_dir.resolve()
    out_s = str(out).replace("\\", "/").lower()
    if "translate-en_de" in out_s or "/en-de/" in out_s + "/":
        print("Refusing to write under en-de / production EN-DE paths.", file=sys.stderr)
        return 2

    exclude = [e.lower() for e in args.exclude_substring]
    kept: list[tuple[str, str, str, str]] = []  # id, src, tgt, source_file
    stats: dict = {
        "inputs": [],
        "rows_read": 0,
        "dropped_lang": 0,
        "dropped_empty": 0,
        "dropped_identical": 0,
        "dropped_length": 0,
        "dropped_duplicate": 0,
        "excluded_files": [],
        "kept": 0,
        "src_lang": args.src_lang,
        "tgt_lang": args.tgt_lang,
        "lang": args.lang,
    }
    seen: set[tuple[str, str]] = set()

    for csv_path in args.inputs:
        csv_path = csv_path.resolve()
        if any(ex in str(csv_path).lower() for ex in exclude):
            stats["excluded_files"].append(str(csv_path))
            print(f"EXCLUDED (NC/other): {csv_path.name}")
            continue
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

    src_l, tgt_l = args.src_lang, args.tgt_lang
    fwd = out / f"{src_l}2{tgt_l}"
    rev = out / f"{tgt_l}2{src_l}"
    fwd.mkdir(parents=True, exist_ok=True)
    rev.mkdir(parents=True, exist_ok=True)

    def dump(split_name: str, rows: list) -> None:
        # forward: src->tgt
        write_parallel(
            fwd / f"{split_name}.{src_l}",
            fwd / f"{split_name}.{tgt_l}",
            [(s, t) for _, s, t, _ in rows],
        )
        # reverse: tgt->src
        write_parallel(
            rev / f"{split_name}.{tgt_l}",
            rev / f"{split_name}.{src_l}",
            [(t, s) for _, s, t, _ in rows],
        )

    dump("train", train)
    dump("valid", valid)
    dump("test", test)

    with (out / "pairs.tsv").open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(f"id\t{src_l}\t{tgt_l}\tsplit\tsource_file\n")
        for split_name, rows in (("test", test), ("valid", valid), ("train", train)):
            for pair_id, s, t, src_file in rows:
                fh.write(f"{pair_id}\t{s}\t{t}\t{split_name}\t{src_file}\n")

    stats["split"] = {"train": len(train), "valid": len(valid), "test": len(test)}
    stats["filters"] = {
        "min_chars": args.min_chars,
        "max_chars": args.max_chars,
        "min_words": args.min_words,
        "max_ratio": args.max_ratio,
        "seed": args.seed,
    }
    stats["note"] = (
        f"Bidirectional splits under {fwd.name}/ and {rev.name}/. "
        "Did not modify en-de training or production Argos models."
    )
    (out / "prepare_report.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(stats, indent=2, ensure_ascii=False))
    print(f"Wrote under {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
