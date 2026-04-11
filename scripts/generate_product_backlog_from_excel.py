# -*- coding: utf-8 -*-
"""Regenerate docs/requirements/03_product-backlog_ua.md from Excel User Stories (1 row = 1 bullet)."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JSON_PATH = ROOT / ".agent-extract" / "User_Stories.json"
OUT_PATH = ROOT / "docs" / "requirements" / "03_product-backlog_ua.md"

EPIC_TITLES_UA = {
    1: "Картка пацієнта",
    2: "Партнерські клініки/провайдери",
    3: "Призначення відповідальних",
    4: "Терміни (Appointments)",
    5: "Документи",
    6: "Е-підпис",
    7: "Оновлення медичних даних",
    8: "Комунікація",
    9: "Білінг/фінанси",
    10: "Перекладачі",
    11: "Продажі",
    12: "Шаблони",
    13: "Політики доступу і публікації",
    14: "Безпека",
    15: "Навчальний модуль",
    16: "VIP-сервіси",
    17: "Feedback",
    18: "Workflow/To-Do",
    19: "Self-Service портал",
    20: "Ризик-аналіз",
    21: "Календар і керування термінами",
    22: "Модуль CEO",
    23: "Замовлення (Aufträge)",
    24: "AI",
}


def rolle_ua(de: str) -> str:
    de = (de or "").strip()
    m = {
        "Patientenmanager": "Пацієнт-менеджер",
        "CEO": "CEO",
        "Patient": "Пацієнт",
        "Abrechnung": "Фінанси (Abrechnung)",
        "Vertrieb": "Продажі",
        "Teamlead Dolmetscher": "Teamlead Dolmetscher",
        "Dolmetscher": "Перекладач",
        "Concierge": "Concierge",
        "Patientenmanager/System": "Пацієнт-менеджер / Система",
        "System": "Система",
        "IT-Admin": "IT/Admin",
        "Mitarbeiter": "Співробітники",
        "Patientenmanager/Abrechnung": "Пацієнт-менеджер / Фінанси",
        "CEO/Patientenmanager/Abrechnung": "CEO / Пацієнт-менеджер / Фінанси",
        "Teamlead": "Teamlead",
        "Organisation": "Організаційно",
    }
    if de in m:
        return m[de]
    if "/" in de:
        parts = [rolle_ua(p.strip()) for p in de.split("/")]
        return " / ".join(dict.fromkeys(parts))
    return de or "—"


def priority_tag(p: str) -> str:
    p = (p or "").strip()
    if p.isdigit():
        return f"P{p}"
    return "P1"


def esc_md(s: str) -> str:
    return s.replace("|", "\\|")


def main() -> None:
    rows = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    header = rows[0]

    lines: list[str] = []
    lines.append("# Функціональний scope за епіками")
    lines.append("")
    lines.append(
        "> **Джерело правди:** аркуш `User Stories` у `docs/1 (Update 2) User Story Salesforce.xlsx` "
        f"({', '.join(header)}). Кожен пункт нижче відповідає **одному рядку** цього аркуша (номер рядка вказано). "
        "Колонки *User Story* та *Beschreibung* наведені **німецькою** як у джерелі (трасованість). Повний український переклад кожного абзацу можна додати підпунктом *UA* після узгодження з клієнтом. "
        "Ієрархія джерел: `docs/00_source-of-truth_ua.md`."
    )
    lines.append("")
    lines.append("<!--")
    lines.append("  Порядковий аудит Excel ↔ цей файл: docs/testing/user-stories-excel-backlog-audit_ua.md")
    lines.append("  Оновити: python scripts/audit_excel_vs_backlog.py")
    lines.append("  Регенерація з Excel: python scripts/generate_product_backlog_from_excel.py")
    lines.append("-->")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Історична назва документа")
    lines.append("")
    lines.append("Product Backlog (UA) — трасований до User Stories Salesforce.")
    lines.append("")
    lines.append(
        "> Позначення пріоритетів з Excel: `1` — критично, `2` — високо, `3` — середньо, `4` — нижче. "
        "Якщо клітинка Priority порожня, у цьому файлі для узгодженості з маркдауном використано **`P1`** — уточнити в Excel за потреби."
    )
    lines.append("")

    cur_epic: int | None = None
    for idx, row in enumerate(rows[1:], start=2):
        cells = list(row) + [""] * 6
        epic_cell = cells[0].strip()
        if epic_cell.startswith("EPIC"):
            m = re.match(r"EPIC\s+(\d+)\s*:", epic_cell)
            if m:
                cur_epic = int(m.group(1))
                title = EPIC_TITLES_UA.get(cur_epic, f"EPIC {cur_epic}")
                lines.append(f"## EPIC {cur_epic}: {title}")
                lines.append("")
        story = cells[2].strip()
        if not story or cur_epic is None:
            continue

        rol_raw = cells[1].strip()
        if not rol_raw:
            if "SOPs" in story or "Sichtbarkeit" in story:
                rol_raw = "Organisation"
            elif "Audit-Log" in story:
                rol_raw = "CEO"
            elif story.lower().startswith("ai ") or story == "AI integration":
                rol_raw = "System"
            else:
                rol_raw = "System"
        rol = rolle_ua(rol_raw)
        pt = priority_tag(cells[5])
        desc = cells[3].strip()
        sec = cells[4].strip()

        lines.append(
            f"- **[{pt}] {rol}** *(Excel аркуш `User Stories`, **ряд. {idx}**)* — *User Story (DE):* «{esc_md(story)}»."
        )
        if desc:
            if len(desc) > 1200:
                lines.append(
                    f"  - *Beschreibung (DE, скорочено; повний текст у Excel):* {esc_md(desc[:1200])}…"
                )
            else:
                lines.append(f"  - *Beschreibung (DE):* {esc_md(desc)}")
        if sec:
            lines.append(f"  - *Security/Compliance (DE):* {esc_md(sec)}")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## Пов'язані канонічні документи")
    lines.append("")
    lines.append("Супутні аспекти, винесені в окремі документи:")
    lines.append("")
    lines.append("- RBAC: `docs/backlog/02_rbac-matrix_ua.md`")
    lines.append("- KPI: `docs/backlog/03_kpi-catalog_ua.md`")
    lines.append("- Delivery backlog: `docs/backlog/01_mvp-backlog_ua.md`")
    lines.append("- Implementation tasks: `docs/backlog/04_implementation-tasks_ua.md`")
    lines.append("- Architecture: `docs/architecture/01_target-architecture_ua.md`")
    lines.append("")
    lines.append("## Підсумок для вимог")
    lines.append("")
    lines.append("- Цей документ фіксує функціональний scope **рядок-у-рядок** з Excel.")
    lines.append("- Для планування реалізації використовуються delivery-документи в `docs/backlog/`.")
    lines.append(
        "- Нефункціональні вимоги: `docs/requirements/04_non-functional-requirements_ua.md`."
    )
    lines.append("")

    OUT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT_PATH} ({len(lines)} lines)")


if __name__ == "__main__":
    main()
