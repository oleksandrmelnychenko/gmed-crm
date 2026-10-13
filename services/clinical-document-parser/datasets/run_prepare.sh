#!/bin/bash
set -euo pipefail
ROOT=/mnt/c/Users/oleks/Developer/gmed/services/clinical-document-parser
PREP="$ROOT/training/de-uk/scripts/prepare_bidirectional.py"

echo "===== DE-UK commercial (exclude TED NC) ====="
mapfile -t UK_CSV < <(ls "$ROOT"/datasets/de-uk/csv/*.csv | grep -vi TED2020)
python3 "$PREP" \
  --inputs "${UK_CSV[@]}" \
  --out-dir "$ROOT/training/de-uk/out/merged-commercial" \
  --src-lang de --tgt-lang uk --lang de-uk \
  --seed 42 --min-chars 8 --max-chars 800 --min-words 2 --max-ratio 2.5

echo "===== DE-UK with TED (research / NC track) ====="
mapfile -t UK_ALL < <(ls "$ROOT"/datasets/de-uk/csv/*.csv)
python3 "$PREP" \
  --inputs "${UK_ALL[@]}" \
  --out-dir "$ROOT/training/de-uk/out/merged-with-ted-nc" \
  --src-lang de --tgt-lang uk --lang de-uk \
  --seed 42 --min-chars 8 --max-chars 800 --min-words 2 --max-ratio 2.5

echo "===== DE-RU commercial (exclude TED NC) ====="
mapfile -t RU_CSV < <(ls "$ROOT"/datasets/de-ru/csv/*.csv | grep -vi TED2020)
python3 "$ROOT/training/de-ru/scripts/prepare_bidirectional.py" \
  --inputs "${RU_CSV[@]}" \
  --out-dir "$ROOT/training/de-ru/out/merged-commercial" \
  --src-lang de --tgt-lang ru --lang de-ru \
  --seed 42 --min-chars 8 --max-chars 800 --min-words 2 --max-ratio 2.5

echo "===== DE-RU with TED (research / NC track) ====="
mapfile -t RU_ALL < <(ls "$ROOT"/datasets/de-ru/csv/*.csv)
python3 "$ROOT/training/de-ru/scripts/prepare_bidirectional.py" \
  --inputs "${RU_ALL[@]}" \
  --out-dir "$ROOT/training/de-ru/out/merged-with-ted-nc" \
  --src-lang de --tgt-lang ru --lang de-ru \
  --seed 42 --min-chars 8 --max-chars 800 --min-words 2 --max-ratio 2.5

echo "===== line counts ====="
for d in \
  "$ROOT/training/de-uk/out/merged-commercial/de2uk" \
  "$ROOT/training/de-uk/out/merged-commercial/uk2de" \
  "$ROOT/training/de-uk/out/merged-with-ted-nc/de2uk" \
  "$ROOT/training/de-ru/out/merged-commercial/de2ru" \
  "$ROOT/training/de-ru/out/merged-commercial/ru2de" \
  "$ROOT/training/de-ru/out/merged-with-ted-nc/de2ru"
do
  echo "-- $d"
  wc -l "$d"/train.* "$d"/valid.* "$d"/test.* 2>/dev/null | tail -n 20
done
