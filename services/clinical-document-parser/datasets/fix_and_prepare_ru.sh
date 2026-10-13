#!/bin/bash
set -euo pipefail
ROOT=/mnt/c/Users/oleks/Developer/gmed/services/clinical-document-parser

# Bump csv field size limit in both prepare scripts
for f in \
  "$ROOT/training/de-uk/scripts/prepare_bidirectional.py" \
  "$ROOT/training/de-ru/scripts/prepare_bidirectional.py" \
  "$ROOT/datasets/prepare_bidirectional.py"
do
  if [ -f "$f" ]; then
    python3 - <<PY
from pathlib import Path
p = Path("$f")
t = p.read_text(encoding="utf-8")
needle = "import csv\n"
inject = "import csv\ncsv.field_size_limit(min(2**31 - 1, 10**9))\n"
if "field_size_limit" not in t:
    if needle not in t:
        raise SystemExit(f"no import csv in {p}")
    t = t.replace(needle, inject, 1)
    p.write_text(t, encoding="utf-8")
    print(f"patched {p}")
else:
    print(f"already patched {p}")
PY
  fi
done

# Find oversized lines in de-ru CSVs
python3 - <<'PY'
import csv
from pathlib import Path
csv.field_size_limit(min(2**31-1, 10**9))
root = Path("/mnt/c/Users/oleks/Developer/gmed/services/clinical-document-parser/datasets/de-ru/csv")
for p in sorted(root.glob("*.csv")):
    max_len = 0
    n = 0
    bad = 0
    with p.open(encoding="utf-8", newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            n += 1
            for k,v in row.items():
                if v and len(v) > max_len:
                    max_len = len(v)
                if v and len(v) > 100000:
                    bad += 1
    print(f"{p.name}: rows={n} max_field={max_len} over100k={bad}")
PY

echo "===== DE-RU commercial ====="
mapfile -t RU_COMM < <(ls "$ROOT"/datasets/de-ru/csv/*.csv | grep -vi TED2020)
python3 "$ROOT/training/de-ru/scripts/prepare_bidirectional.py" \
  --inputs "${RU_COMM[@]}" \
  --out-dir "$ROOT/training/de-ru/out/merged-commercial" \
  --src-lang de --tgt-lang ru --lang de-ru \
  --seed 42 --min-chars 8 --max-chars 800 --min-words 2 --max-ratio 2.5

echo "===== DE-RU with TED NC ====="
mapfile -t RU_ALL < <(ls "$ROOT"/datasets/de-ru/csv/*.csv)
python3 "$ROOT/training/de-ru/scripts/prepare_bidirectional.py" \
  --inputs "${RU_ALL[@]}" \
  --out-dir "$ROOT/training/de-ru/out/merged-with-ted-nc" \
  --src-lang de --tgt-lang ru --lang de-ru \
  --seed 42 --min-chars 8 --max-chars 800 --min-words 2 --max-ratio 2.5

echo "===== FINAL COUNTS ====="
python3 - <<'PY'
from pathlib import Path
import json
root = Path("/mnt/c/Users/oleks/Developer/gmed/services/clinical-document-parser/training")
for pair in ("de-uk", "de-ru"):
  for merge in ("merged-commercial", "merged-with-ted-nc"):
    base = root / pair / "out" / merge
    print(f"\n## {pair}/{merge}")
    # find report
    for name in ("prepare_report.json", "report.json"):
      rp = base / name
      if rp.exists():
        d = json.loads(rp.read_text(encoding="utf-8"))
        print("kept", d.get("kept"), "split", d.get("split") or d.get("splits"))
        break
    for sub in sorted([p for p in base.iterdir() if p.is_dir()]):
      for split in ("train", "valid", "test"):
        files = list(sub.glob(f"{split}.*"))
        if not files:
          continue
        n = sum(1 for _ in files[0].open(encoding="utf-8"))
        print(f"  {sub.name}/{split}: {n}")
PY
