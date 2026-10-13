#!/bin/bash
set -euo pipefail
ROOT=/mnt/c/Users/oleks/Developer/gmed/services/clinical-document-parser

echo "=== tree snippets ==="
find "$ROOT/datasets/de-uk" "$ROOT/datasets/de-ru" "$ROOT/training/de-uk" "$ROOT/training/de-ru" -maxdepth 3 -type d 2>/dev/null | head -80
echo "=== scripts ==="
ls -la "$ROOT/training/de-uk/scripts" "$ROOT/training/de-ru/scripts" 2>/dev/null
echo "=== csv counts ==="
ls "$ROOT/datasets/de-uk/csv" 2>/dev/null | wc -l
ls "$ROOT/datasets/de-ru/csv" 2>/dev/null | wc -l
ls "$ROOT/datasets/de-uk/csv" 2>/dev/null
ls "$ROOT/datasets/de-ru/csv" 2>/dev/null
echo "=== reports ==="
find "$ROOT/training/de-uk/out" "$ROOT/training/de-ru/out" -name '*.json' 2>/dev/null
echo "=== medical ==="
ls "$ROOT/datasets/medical-verified-2026-09-24"/*.tsv 2>/dev/null

# Append pointer to DATASETS.md if missing
if ! grep -q 'DATASETS-de-uk-ru.md' "$ROOT/datasets/DATASETS.md" 2>/dev/null; then
  printf '\n\n---\n\n## DE↔UK / DE↔RU track\n\nSee **[DATASETS-de-uk-ru.md](DATASETS-de-uk-ru.md)** for German↔Ukrainian / German↔Russian corpora, licenses, and prepared train paths. Parallel track; does not replace EN→DE.\n' >> "$ROOT/datasets/DATASETS.md"
  echo "appended DATASETS.md pointer"
else
  echo "DATASETS.md pointer already present"
fi
