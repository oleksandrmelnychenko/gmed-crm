from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile


ROOT = Path(__file__).resolve().parent.parent
PRINT_DIR = ROOT / "docs" / "print"
MANIFEST_PATH = PRINT_DIR / "bindings-manifest.json"
BACKEND_PATH = ROOT / "crates" / "server" / "src" / "routes" / "documents.rs"
FRONTEND_PATH = (
    ROOT / "frontend" / "src" / "pages" / "documents" / "model" / "document-bindings.ts"
)
WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": WORD_NS}
YELLOW_VALUES = {"yellow", "darkYellow"}


def extract_yellow_groups(path: Path) -> list[str]:
    with ZipFile(path) as archive:
        root = ET.fromstring(archive.read("word/document.xml"))

    groups: list[str] = []
    for paragraph in root.findall(".//w:p", NS):
        current: list[str] = []
        for run in paragraph.findall(".//w:r", NS):
            highlight = run.find("./w:rPr/w:highlight", NS)
            is_yellow = (
                highlight is not None
                and highlight.get(f"{{{WORD_NS}}}val") in YELLOW_VALUES
            )
            text = "".join(node.text or "" for node in run.findall(".//w:t", NS))
            if is_yellow:
                current.append(text)
            elif current:
                value = "".join(current).strip()
                if value:
                    groups.append(value)
                current = []
        if current:
            value = "".join(current).strip()
            if value:
                groups.append(value)
    return groups


def groups_digest(groups: list[str]) -> str:
    return hashlib.sha256("\n".join(groups).encode("utf-8")).hexdigest()


def contains_token(source: str, token: str) -> bool:
    return re.search(rf"(?<![A-Za-z0-9_]){re.escape(token)}(?![A-Za-z0-9_])", source) is not None


def main() -> int:
    errors: list[str] = []
    if not MANIFEST_PATH.is_file():
        print(f"Missing manifest: {MANIFEST_PATH.relative_to(ROOT)}", file=sys.stderr)
        return 1

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    entries = manifest.get("documents")
    if not isinstance(entries, list) or not entries:
        print("Print binding manifest contains no documents", file=sys.stderr)
        return 1

    backend = BACKEND_PATH.read_text(encoding="utf-8")
    frontend = FRONTEND_PATH.read_text(encoding="utf-8")
    manifest_files = {entry.get("file") for entry in entries}
    actual_files = {path.name for path in PRINT_DIR.glob("*.docx")}
    for name in sorted(actual_files - manifest_files):
        errors.append(f"DOCX is not registered in manifest: {name}")
    for name in sorted(manifest_files - actual_files):
        errors.append(f"Manifest DOCX is missing: {name}")

    total_highlights = 0
    for entry in entries:
        name = entry.get("file")
        template_id = entry.get("template_id")
        if not isinstance(name, str) or not isinstance(template_id, str):
            errors.append(f"Invalid manifest entry: {entry!r}")
            continue
        path = PRINT_DIR / name
        if not path.is_file():
            continue
        try:
            groups = extract_yellow_groups(path)
        except (BadZipFile, KeyError, ET.ParseError) as error:
            errors.append(f"Cannot inspect {name}: {error}")
            continue
        total_highlights += len(groups)
        expected_count = entry.get("highlight_count")
        if len(groups) != expected_count:
            errors.append(
                f"{name}: yellow group count changed ({len(groups)} != {expected_count})"
            )
        digest = groups_digest(groups)
        if digest != entry.get("highlight_sha256"):
            errors.append(f"{name}: yellow binding fingerprint changed ({digest})")
        if not groups and not entry.get("allow_no_highlights", False):
            errors.append(f"{name}: no yellow bindings found")

        if f'id: "{template_id}"' not in backend:
            errors.append(f"{name}: backend template is missing: {template_id}")
        if f"{template_id}: [" not in frontend and f"{template_id}: " not in frontend:
            errors.append(f"{name}: frontend binding schema is missing: {template_id}")

        manual_keys = entry.get("manual_binding_keys", [])
        runtime_tokens = entry.get("runtime_tokens", [])
        if groups and not manual_keys and not runtime_tokens:
            errors.append(f"{name}: highlighted values have no runtime mapping")
        for key in manual_keys:
            if not contains_token(backend, key):
                errors.append(f"{name}: backend binding key is missing: {key}")
            frontend_key = "service_lines_text" if key == "service_lines" else (
                "clinics_text" if key == "clinics" else key
            )
            if not contains_token(frontend, frontend_key):
                errors.append(f"{name}: frontend binding key is missing: {frontend_key}")
        for token in runtime_tokens:
            if not contains_token(backend, token):
                errors.append(f"{name}: runtime token is missing: {token}")

    for forbidden in ("Heorhii Hudiiev", "Salesforce"):
        if forbidden in backend:
            errors.append(f"Hard-coded legal/document identity remains in backend: {forbidden}")

    if errors:
        print("Print binding audit failed:", file=sys.stderr)
        for error in errors:
            print(f" - {error}", file=sys.stderr)
        return 1

    print(
        f"Print binding audit passed: {len(entries)} DOCX references, "
        f"{total_highlights} grouped yellow bindings, all mapped."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
