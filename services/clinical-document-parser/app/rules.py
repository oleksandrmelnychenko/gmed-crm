from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


RULES_DIR = Path(__file__).resolve().parent.parent / "rules"


@lru_cache(maxsize=1)
def load_rules() -> dict[str, Any]:
    merged: dict[str, Any] = {"section_aliases": {}, "document_type_hints": {}, "translation_headings": {}, "translation_terms": {}, "translation_term_repairs": [], "laboratory_analyte_ocr_aliases": {}}
    for path in sorted(RULES_DIR.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        merged["translation_headings"].update(payload.get("translation_headings", {}))
        merged["translation_terms"].update(payload.get("translation_terms", {}))
        merged["translation_term_repairs"].extend(payload.get("translation_term_repairs", []))
        merged["laboratory_analyte_ocr_aliases"].update(payload.get("laboratory_analyte_ocr_aliases", {}))
        for target, aliases in payload.get("section_aliases", {}).items():
            existing = merged["section_aliases"].setdefault(target, [])
            existing.extend(alias for alias in aliases if alias not in existing)
        for document_type, hints in payload.get("document_type_hints", {}).items():
            existing = merged["document_type_hints"].setdefault(document_type, [])
            existing.extend(hint for hint in hints if hint not in existing)
    return merged
