#!/bin/bash
set -euo pipefail
ROOT=/mnt/c/Users/oleks/Developer/gmed/services/clinical-document-parser
# show prepare help briefly
python3 "$ROOT/training/de-uk/scripts/prepare_bidirectional.py" --help | head -40
echo "==== CSV lists ===="
ls "$ROOT/datasets/de-uk/csv" | wc -l
ls "$ROOT/datasets/de-ru/csv" | wc -l

run_one() {
  local pair="$1" src="$2" tgt="$3" out="$4"
  shift 4
  local script="$ROOT/training/${pair}/scripts/prepare_bidirectional.py"
  echo "===== PREPARE $out ====="
  python3 "$script" \
    --inputs "$@" \
    --out-dir "$ROOT/training/${pair}/out/${out}" \
    --src-lang "$src" --tgt-lang "$tgt" --lang "$pair" \
    --seed 42 --min-chars 8 --max-chars 800 --min-words 2 --max-ratio 2.5
}

# Commercial DE-UK (exclude TED NC)
mapfile -t UK_COMM < <(ls "$ROOT"/datasets/de-uk/csv/*.csv | grep -vi TED2020)
run_one de-uk de uk merged-commercial "${UK_COMM[@]}"

# With TED NC track
mapfile -t UK_ALL < <(ls "$ROOT"/datasets/de-uk/csv/*.csv)
run_one de-uk de uk merged-with-ted-nc "${UK_ALL[@]}"

mapfile -t RU_COMM < <(ls "$ROOT"/datasets/de-ru/csv/*.csv | grep -vi TED2020)
run_one de-ru de ru merged-commercial "${RU_COMM[@]}"

mapfile -t RU_ALL < <(ls "$ROOT"/datasets/de-ru/csv/*.csv)
run_one de-ru de ru merged-with-ted-nc "${RU_ALL[@]}"

echo "===== COUNTS ====="
python3 - <<'PY'
from pathlib import Path
root = Path("/mnt/c/Users/oleks/Developer/gmed/services/clinical-document-parser/training")
for pair in ("de-uk", "de-ru"):
  for merge in ("merged-commercial", "merged-with-ted-nc"):
    base = root / pair / "out" / merge
    report = base / "prepare_report.json"
    print(f"\n## {pair}/{merge}")
    if report.exists():
      import json
      d = json.loads(report.read_text(encoding="utf-8"))
      print("kept", d.get("kept"), "split", d.get("split"))
      print("inputs kept:", [(i["path"].split("/")[-1], i["kept"]) for i in d.get("inputs", [])])
    for sub in sorted(base.glob("*")):
      if sub.is_dir():
        for f in sorted(sub.glob("train.*")):
          n = sum(1 for _ in f.open(encoding="utf-8"))
          print(f"  {sub.name}/{f.name}: {n}")
PY
