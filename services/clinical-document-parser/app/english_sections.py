"""Paragraph boundaries for English prose; no inference of clinical facts."""
from __future__ import annotations

import re


def prose_paragraphs(text: str, line_pages: list[int], default_page: int | None) -> list[tuple[str, str, int | None]]:
    paragraphs: list[tuple[str, str, int | None]] = []
    lines: list[str] = []
    page = default_page

    def flush() -> None:
        nonlocal lines
        if not lines:
            return
        source = "\n".join(lines)
        value = " ".join(source.split())
        # Keep an explicit compound hyphen when joining physical PDF lines.
        value = re.sub(r"(?<=[A-Za-z])- (?=[a-z])", "-", value)
        paragraphs.append((value, source, page))
        lines = []

    for index, line in enumerate(text.splitlines()):
        if not line.strip():
            flush()
            continue
        if not lines:
            page = line_pages[index] if index < len(line_pages) else default_page
        lines.append(line.strip())
    flush()
    return paragraphs


def prose_diagnosis_rows(text: str, line_pages: list[int], default_page: int | None) -> list[tuple[str, int | None]]:
    rows: list[tuple[str, int | None]] = []
    for value, source, page in prose_paragraphs(text, line_pages, default_page):
        # Explicit bullets remain separate facts. Otherwise a sentence belongs
        # together even when it wraps across several physical PDF lines.
        if re.search(r"^\s*(?:[-*•]|\d+[.)])\s+", source, re.MULTILINE):
            clauses = re.split(r"(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+", source)
        elif re.search(r"[.!?]\s+[A-Z]", value):
            clauses = re.split(r"(?<=[.!?])\s+(?=[A-Z])", value)
        else:
            # A long unpunctuated list is still a list. Join only physical
            # continuations, not the next capitalized diagnostic statement.
            clauses = []
            for line in source.splitlines():
                continuation = bool(clauses and (
                    line[:1].islower() or clauses[-1].endswith((",", "-", " with", " of", " and", " in", " the"))
                ))
                if continuation:
                    clauses[-1] += " " + line
                else:
                    clauses.append(line)
        rows.extend((" ".join(clause.split()).strip(), page) for clause in clauses if clause.strip())
    return rows


def therapy_recommendation_rows(text: str, line_pages: list[int], default_page: int | None) -> list[tuple[str, str, int | None]]:
    rows: list[tuple[str, str, int | None]] = []
    for value, source, page in prose_paragraphs(text, line_pages, default_page):
        if re.match(r"^(?:[IVX]+\.\s*)?(?:Available in pharmacies|Not pharmacy-only)\b", value, re.IGNORECASE):
            continue
        if rows and value[:1].islower():
            previous, evidence, original_page = rows[-1]
            rows[-1] = (f"{previous} {value}", f"{evidence}\n{source}", original_page)
        else:
            rows.append((value, source, page))
    return rows
