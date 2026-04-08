from __future__ import annotations

import os
import subprocess
from pathlib import Path

import markdown


BASE_DIR = Path(__file__).resolve().parent
OUTPUT_HTML = BASE_DIR / "comparison-release-package.html"
OUTPUT_PDF = BASE_DIR / "comparison-release-package.pdf"

RELEASE_DOC = "client-release-package.md"


CSS = r"""
@page {
  size: A4;
  margin: 20mm 16mm 20mm 16mm;
}

body {
  font-family: "Segoe UI", Arial, sans-serif;
  font-size: 11pt;
  line-height: 1.45;
  color: #1f2937;
}

h1, h2, h3, h4 {
  font-family: "Segoe UI", Arial, sans-serif;
  font-weight: 700;
  color: #111827;
  margin-top: 18px;
  margin-bottom: 8px;
}

h1 {
  font-size: 22pt;
  border-bottom: 1px solid #d1d5db;
  padding-bottom: 6px;
}

h2 {
  font-size: 16pt;
}

h3 {
  font-size: 13pt;
}

p, li {
  margin-top: 4px;
  margin-bottom: 4px;
}

blockquote {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3px solid #9ca3af;
  background: #f9fafb;
}

code {
  font-family: Consolas, "Courier New", monospace;
  font-size: 9pt;
  background: #f3f4f6;
  padding: 1px 3px;
}

pre {
  font-family: Consolas, "Courier New", monospace;
  font-size: 9pt;
  white-space: pre-wrap;
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  padding: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  table-layout: fixed;
}

th, td {
  border: 1px solid #d1d5db;
  padding: 6px 8px;
  vertical-align: top;
}

th {
  font-family: "Segoe UI", Arial, sans-serif;
  background: #f3f4f6;
  font-weight: bold;
}

ul, ol {
  padding-left: 18px;
}

a {
  color: #1d4ed8;
  text-decoration: none;
}

.doc-section {
  page-break-before: always;
}

.doc-section.first {
  page-break-before: auto;
}

.doc-meta {
  color: #4b5563;
  font-size: 10pt;
  margin-bottom: 10px;
}

.doc-name {
  color: #6b7280;
  font-size: 9pt;
  margin-bottom: 12px;
}

.footer-note {
  color: #6b7280;
  font-size: 9pt;
  margin-top: 18px;
}
"""


def md_to_html(text: str) -> str:
    return markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "sane_lists", "nl2br"],
        output_format="html5",
    )


def build_document_sections() -> str:
    path = BASE_DIR / RELEASE_DOC
    raw = path.read_text(encoding="utf-8")
    rendered = md_to_html(raw)
    return f'<section class="doc-section first">{rendered}</section>'


def build_html() -> str:
    body = build_document_sections()
    return f"""<!doctype html>
<html lang="uk">
  <head>
    <meta charset="utf-8">
    <title>Порівняння</title>
    <style>{CSS}</style>
  </head>
  <body>
    {body}
  </body>
</html>
"""


def _edge_executable() -> Path | None:
    env = os.environ.get("EDGE_PATH")
    if env:
        p = Path(env)
        if p.is_file():
            return p
    for candidate in (
        Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
        Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    ):
        if candidate.is_file():
            return candidate
    return None


def generate_pdf_via_edge(html_path: Path, pdf_path: Path) -> None:
    edge = _edge_executable()
    if edge is None:
        raise SystemExit(
            "Microsoft Edge not found. Install Edge or set EDGE_PATH to msedge.exe."
        )
    pdf_path.unlink(missing_ok=True)
    uri = html_path.resolve().as_uri()
    cmd = [
        str(edge),
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={pdf_path.resolve()}",
        uri,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    if result.returncode != 0 or not pdf_path.is_file():
        msg = result.stderr or result.stdout or "no output"
        raise SystemExit(f"Edge print-to-pdf failed ({result.returncode}): {msg}")


def main() -> None:
    html_content = build_html()
    OUTPUT_HTML.write_text(html_content, encoding="utf-8")
    print(f"HTML: {OUTPUT_HTML}")
    generate_pdf_via_edge(OUTPUT_HTML, OUTPUT_PDF)
    print(f"PDF: {OUTPUT_PDF}")


if __name__ == "__main__":
    main()
