#!/bin/bash
python3 - <<'PY'
import json
from pathlib import Path
root=Path("/mnt/c/Users/oleks/Developer/gmed/services/clinical-document-parser/training")
for p in sorted(root.glob("*/out/*/prepare_report.json")):
  d=json.loads(p.read_text())
  print(p.relative_to(root), "kept=", d.get("kept"), "split=", d.get("split") or d.get("splits"))
PY
