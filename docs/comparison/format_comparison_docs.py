"""Normalize comparison markdown: no ## 1. numbering; list markers as '-'. Run once after edits."""

from __future__ import annotations

import re
from pathlib import Path

BASE = Path(__file__).resolve().parent


def strip_numbered_h2_h3(text: str) -> str:
    text = re.sub(r"^### (\d+\.\d+) (.+)$", r"### \2", text, flags=re.M)
    text = re.sub(r"^## (\d+\.\d+) (.+)$", r"### \2", text, flags=re.M)
    text = re.sub(r"^## (\d+)\. (.+)$", r"## \2", text, flags=re.M)
    return text


def dash_numbered_lines_in_section(text: str, start_heading: str, end_marker: str) -> str:
    i = text.find(start_heading)
    if i < 0:
        return text
    j = text.find(end_marker, i)
    if j < 0:
        return text
    head = text[: i + len(start_heading)]
    mid = text[i + len(start_heading) : j]
    tail = text[j:]
    mid2 = []
    for line in mid.splitlines():
        mid2.append(re.sub(r"^(\d+)\.\s+", "- ", line))
    return head + "\n".join(mid2) + tail


def format_salesforce() -> None:
    path = BASE / "salesforce-vs-custom-platform.md"
    sf = path.read_text(encoding="utf-8")
    sf = strip_numbered_h2_h3(sf)
    sf = dash_numbered_lines_in_section(
        sf,
        "## Юридичні та договірні питання, які потребують окремого підтвердження\n\n",
        "\n---\n\n## Додатки\n",
    )
    # intro lines for section 12 -> bullets
    sf = sf.replace(
        "Цей документ є стратегічним і технологічним порівнянням. Перед фінальним рішенням рекомендовано окремо підтвердити з профільним юристом і, за потреби, зовнішнім консультантом такі питання:\n\n-",
        "- документ має стратегічно-технологічний характер і не замінює юридичний due diligence;\n"
        "- перед рішенням узгодити з профільним юристом (за потреби — зовнішнім консультантом) таке:\n\n-",
    )
    sf = dash_numbered_lines_in_section(
        sf,
        "## Публічні джерела, перевірені станом на квітень 2026 року\n\n",
        "\n---\n\n*Оновлено:",
    )
    sf = re.sub(r"\n---\n\n\*Оновлено:.*?\*\s*", "\n", sf, flags=re.DOTALL)
    # Додатки: клієнтські пункти, без внутрішніх шляхів
    sf = re.sub(
        r"## Додатки\n\n[\s\S]*?(?=\n---\n\n## Публічні джерела)",
        "## Додатки\n\n"
        "- юридичний ризик: controller, processor, liability, breach response;\n"
        "- checklist договору для власної платформи;\n"
        "- TCO (загальна вартість володіння) та вартість входу.\n",
        sf,
        count=1,
    )
    path.write_text(sf, encoding="utf-8")


def format_appendix(name: str) -> None:
    path = BASE / name
    raw = path.read_text(encoding="utf-8")
    # drop author, H1, blockquote, status through first ---
    raw = re.sub(
        r"^>[\s\S]*?\n---\n\n",
        "",
        raw,
        count=1,
        flags=re.M,
    )
    raw = strip_numbered_h2_h3(raw)
    raw = re.sub(r"^## Мета документа$", "## Мета", raw, flags=re.M)
    # numbered lists: lines starting with digit + dot -> -
    lines = raw.splitlines()
    out = []
    for line in lines:
        if re.match(r"^\d+\.\s+", line):
            line = re.sub(r"^\d+\.\s+", "- ", line)
        out.append(line)
    raw = "\n".join(out)
    raw = re.sub(r"\n\*Оновлено:.*?\*\s*", "\n", raw, flags=re.DOTALL)
    path.write_text(raw.lstrip(), encoding="utf-8")


def main() -> None:
    format_salesforce()
    for f in (
        "legal-risk-appendix.md",
        "custom-platform-contract-checklist.md",
        "tco-financial-appendix.md",
    ):
        format_appendix(f)
    print("Formatted comparison markdown files.")


if __name__ == "__main__":
    main()
