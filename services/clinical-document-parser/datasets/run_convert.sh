#!/bin/bash
set -euo pipefail
ROOT=/mnt/c/Users/oleks/Developer/gmed/services/clinical-document-parser
python3 "$ROOT/datasets/convert_opus_moses.py" --root "$ROOT"
