from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


RULES_DIR = Path(__file__).resolve().parent.parent / "rules"


@lru_cache(maxsize=1)
def load_rules() -> dict[str, Any]:
    merged: dict[str, Any] = {"section_aliases": {}, "document_type_hints": {}}
    for path in sorted(RULES_DIR.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for target, aliases in payload.get("section_aliases", {}).items():
            existing = merged["section_aliases"].setdefault(target, [])
            existing.extend(alias for alias in aliases if alias not in existing)
        merged["document_type_hints"].update(payload.get("document_type_hints", {}))
    return merged
