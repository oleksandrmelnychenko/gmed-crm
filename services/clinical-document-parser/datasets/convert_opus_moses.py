#!/usr/bin/env python3
"""Convert OPUS Moses zips + medical TSVs into ELRC-style CSVs for de-uk / de-ru."""
from __future__ import annotations

import argparse
import csv
import re
import zipfile
from pathlib import Path

WS_RE = re.compile(r"\s+")


def normalize(text: str) -> str:
    text = text.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\n", " ").strip()
    return WS_RE.sub(" ", text)


def unzip_all(raw_dir: Path, extract_dir: Path) -> list[Path]:
    extract_dir.mkdir(parents=True, exist_ok=True)
    out = []
    for zpath in sorted(raw_dir.glob("*.zip")):
        dest = extract_dir / zpath.stem
        dest.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zpath, "r") as zf:
            zf.extractall(dest)
        out.append(dest)
        print(f"unzipped {zpath.name} -> {dest}")
    return out


def find_moses_pair(folder: Path, src: str, tgt: str) -> tuple[Path, Path] | None:
    # Prefer files ending with .src / .tgt language codes
    files = list(folder.rglob("*"))
    src_cands = [p for p in files if p.is_file() and p.name.endswith(f".{src}")]
    tgt_cands = [p for p in files if p.is_file() and p.name.endswith(f".{tgt}")]
    # Prefer names containing both lang codes
    def score(p: Path) -> int:
        n = p.name.lower()
        return (2 if f"{src}-{tgt}" in n or f"{tgt}-{src}" in n else 0) + (1 if "moses" in n else 0)

    if not src_cands or not tgt_cands:
        return None
    src_cands.sort(key=score, reverse=True)
    tgt_cands.sort(key=score, reverse=True)
    # Match by shared stem prefix when possible
    for s in src_cands:
        stem = s.name[: -len(src) - 1]
        for t in tgt_cands:
            if t.name[: -len(tgt) - 1] == stem:
                return s, t
    return src_cands[0], tgt_cands[0]


def moses_to_csv(src_path: Path, tgt_path: Path, out_csv: Path, lang: str) -> int:
    n = 0
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with src_path.open(encoding="utf-8", errors="replace") as fs, tgt_path.open(
        encoding="utf-8", errors="replace"
    ) as ft, out_csv.open("w", encoding="utf-8", newline="") as fo:
        w = csv.DictWriter(fo, fieldnames=["id", "lang", "source_text", "target_text"])
        w.writeheader()
        for i, (s, t) in enumerate(zip(fs, ft), start=1):
            s, t = normalize(s), normalize(t)
            if not s or not t:
                continue
            w.writerow({"id": str(i), "lang": lang, "source_text": s, "target_text": t})
            n += 1
    return n


def convert_medical_tsv(tsv: Path, out_csv: Path, lang: str, src_col: str, tgt_col: str) -> int:
    n = 0
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    with tsv.open(encoding="utf-8", newline="") as fi, out_csv.open("w", encoding="utf-8", newline="") as fo:
        reader = csv.DictReader(fi, delimiter="\t")
        if not reader.fieldnames:
            raise SystemExit(f"No headers in {tsv}")
        # flexible column match
        fields = {f.lower(): f for f in reader.fieldnames}
        def col(want: str) -> str:
            for k, v in fields.items():
                if want in k or k == want:
                    return v
            # try exact language codes
            raise KeyError(want)

        try:
            sc = col(src_col)
            tc = col(tgt_col)
        except KeyError:
            # fallback: first two non-id columns that look right
            print(f"Headers in {tsv.name}: {reader.fieldnames}")
            raise

        w = csv.DictWriter(fo, fieldnames=["id", "lang", "source_text", "target_text"])
        w.writeheader()
        for i, row in enumerate(reader, start=1):
            s = normalize(row.get(sc) or "")
            t = normalize(row.get(tc) or "")
            if not s or not t:
                continue
            rid = row.get("id") or row.get("ORPHAcode") or row.get("phrase_id") or str(i)
            w.writerow({"id": str(rid), "lang": lang, "source_text": s, "target_text": t})
            n += 1
    return n


def peek_tsv_headers(path: Path) -> list[str]:
    with path.open(encoding="utf-8", newline="") as f:
        r = csv.reader(f, delimiter="\t")
        return next(r)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, required=True)
    args = ap.parse_args()
    root = args.root.resolve()

    report = []

    for pair, src, tgt in (("de-uk", "de", "uk"), ("de-ru", "de", "ru")):
        raw = root / "datasets" / pair / "raw"
        extracted = root / "datasets" / pair / "extracted"
        csv_dir = root / "datasets" / pair / "csv"
        unzip_all(raw, extracted)
        for folder in sorted(p for p in extracted.iterdir() if p.is_dir()):
            pair_files = find_moses_pair(folder, src, tgt)
            if not pair_files:
                print(f"WARN: no moses pair in {folder}")
                continue
            sp, tp = pair_files
            out = csv_dir / f"{folder.name}-{src}-{tgt}.csv"
            n = moses_to_csv(sp, tp, out, f"{src}-{tgt}")
            report.append((pair, out.name, n, "opus-moses"))
            print(f"CSV {out.name}: {n} pairs from {sp.name}+{tp.name}")

    med = root / "datasets" / "medical-verified-2026-09-24"
    # Peek headers
    for name in [
        "Orphadata-rare-diseases-de-uk.tsv",
        "RefugeePhrasebook-medical-de-uk.tsv",
        "RefugeePhrasebook-medical-de-ru.tsv",
    ]:
        p = med / name
        if p.exists():
            print(f"HEADERS {name}: {peek_tsv_headers(p)}")

    # Orphadata DE-UK terminology
    o = med / "Orphadata-rare-diseases-de-uk.tsv"
    if o.exists():
        headers = [h.lower() for h in peek_tsv_headers(o)]
        # expect something like orphacode, de, uk
        de_key = next((h for h in peek_tsv_headers(o) if h.lower() in ("de", "de_name", "name_de", "german")), None)
        uk_key = next((h for h in peek_tsv_headers(o) if h.lower() in ("uk", "uk_name", "name_uk", "ukrainian")), None)
        if de_key and uk_key:
            out = root / "datasets" / "de-uk" / "csv" / "Orphadata-rare-diseases-de-uk.csv"
            n = convert_medical_tsv(o, out, "de-uk", de_key.lower(), uk_key.lower())
            # convert_medical uses substring match via col(); pass actual
            report.append(("de-uk", out.name, n, "medical-term"))
            print(f"CSV {out.name}: {n}")
        else:
            # try flexible
            out = root / "datasets" / "de-uk" / "csv" / "Orphadata-rare-diseases-de-uk.csv"
            n = convert_medical_tsv(o, out, "de-uk", "de", "uk")
            report.append(("de-uk", out.name, n, "medical-term"))

    for tsv_name, pair, sc, tc in [
        ("RefugeePhrasebook-medical-de-uk.tsv", "de-uk", "de", "uk"),
        ("RefugeePhrasebook-medical-de-ru.tsv", "de-ru", "de", "ru"),
    ]:
        p = med / tsv_name
        if not p.exists():
            continue
        out = root / "datasets" / pair / "csv" / (Path(tsv_name).stem + ".csv")
        n = convert_medical_tsv(p, out, pair, sc, tc)
        report.append((pair, out.name, n, "medical-phrasebook-noisy"))
        print(f"CSV {out.name}: {n}")

    # MeSpEn DE-RU glossary if usable
    mes = med / "sources" / "MeSpEn-German-Russian-raw.tsv"
    if mes.exists():
        print(f"HEADERS MeSpEn: {peek_tsv_headers(mes)}")

    print("=== REPORT ===")
    for row in report:
        print("\t".join(map(str, row)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
