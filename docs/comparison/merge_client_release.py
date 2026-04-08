"""Build a single client-release markdown from modular sources (run after editing parts)."""

from __future__ import annotations

import re
from pathlib import Path

BASE = Path(__file__).resolve().parent


def strip_cover(raw: str) -> str:
    raw = re.sub(
        r"\n---\n\n## Важливе застереження.*?(?=\n## Склад пакета|\Z)",
        "",
        raw,
        flags=re.DOTALL,
    )
    raw = re.sub(r"\n## Склад пакета\n\n[\s\S]*\Z", "", raw)
    raw = raw.rstrip()
    if not raw.endswith("---"):
        raw = raw.rstrip() + "\n\n---"
    return raw + "\n\n"


def main_body_and_sources() -> tuple[str, str]:
    raw = (BASE / "salesforce-vs-custom-platform.md").read_text(encoding="utf-8")
    title_m = re.search(
        r"^# Salesforce vs\. Власна платформа\n\n(>[^\n]+\n)\n---\n\n",
        raw,
        re.M,
    )
    title_block = ""
    if title_m:
        intro = title_m.group(1).strip()
        title_block = f"## Salesforce vs. Власна платформа\n\n{intro}\n\n---\n\n"
    exec_m = re.search(r"^## Executive summary", raw, re.M)
    if not exec_m or not title_m:
        raise SystemExit("Unexpected salesforce-vs-custom-platform.md structure.")
    from_exec = raw[exec_m.start() :]
    end_core = from_exec.find("\n---\n\n## Додатки\n")
    if end_core < 0:
        raise SystemExit("Could not find ## Додатки delimiter.")
    core = from_exec[:end_core].rstrip() + "\n\n---\n\n"
    src_m = re.search(r"## Публічні джерела[\s\S]*", from_exec)
    if not src_m:
        raise SystemExit("Could not find public sources section.")
    sources = src_m.group(0).rstrip() + "\n"
    return title_block + core, sources


def appendix_from_file(
    name: str,
    h1_title: str,
    strip_trailing_sources: bool,
) -> str:
    lines = (BASE / name).read_text(encoding="utf-8").splitlines()
    start = -1
    for i, line in enumerate(lines):
        if line.startswith("## Мета"):
            start = i
            break
    if start < 0:
        raise SystemExit(f"{name}: expected ## Мета section.")
    body = "\n".join(lines[start:])
    if strip_trailing_sources:
        body = re.sub(
            r"\n---\n\n## Публічні джерела[\s\S]*",
            "",
            body,
            count=1,
        )
    body = body.rstrip()
    if body.endswith("---"):
        body = body[:-3].rstrip()
    return f"# {h1_title}\n\n{body}\n\n---\n\n"


def main() -> None:
    cover = strip_cover((BASE / "cover-page.md").read_text(encoding="utf-8"))
    core, sources = main_body_and_sources()

    section_13 = (
        "## Додатки\n\n"
        "- юридичний ризик: володілець персональних даних / виконавець обробки / підрядний виконавець обробки (GDPR), договірна відповідальність (liability), реагування на порушення захисту даних (breach response);\n"
        "- контрольний перелік умов договору для власної платформи (checklist);\n"
        "- TCO (загальна вартість володіння) та вартість входу.\n\n"
        "---\n\n"
    )

    parts = [
        cover,
        core,
        section_13,
        appendix_from_file(
            "legal-risk-appendix.md",
            "Додаток A. Юридичний ризик (володілець персональних даних, виконавець і підрядні виконавці обробки за GDPR, договірна відповідальність, реагування на порушення захисту даних)",
            strip_trailing_sources=True,
        ),
        appendix_from_file(
            "custom-platform-contract-checklist.md",
            "Додаток B. Контрольний перелік умов договору для власної платформи (checklist)",
            strip_trailing_sources=False,
        ),
        appendix_from_file(
            "tco-financial-appendix.md",
            "Додаток C. TCO (загальна вартість володіння) та вартість входу",
            strip_trailing_sources=True,
        ),
        sources,
    ]
    (BASE / "client-release-package.md").write_text("".join(parts), encoding="utf-8")
    print(f"Wrote {BASE / 'client-release-package.md'}")


if __name__ == "__main__":
    main()
