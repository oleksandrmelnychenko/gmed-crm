# Documentation Map

Ця папка містить фінальну узгоджену документацію для продукту медичного агентства. Оригінальні джерела клієнта (PDF, Excel) лежать тут саме поруч із канонічними перекладами в `requirements/` та `backlog/`.

**Перед усім іншим:** ієрархія джерел і таблиця відповідності файлів — у [`00_source-of-truth_ua.md`](./00_source-of-truth_ua.md).

## Скрипти синхронізації з Excel

У корені репозиторію (`scripts/`):

- `generate_product_backlog_from_excel.py` — оновлює `requirements/03_product-backlog_ua.md` з аркуша `User Stories`.
- `audit_excel_vs_backlog.py` — оновлює `testing/user-stories-excel-backlog-audit_ua.md` (перевірка 1:1).

## Структура

Документація організована у 3 практичні блоки:

1. `requirements/` - канонічні узгоджені вимоги до продукту.
2. `backlog/` - delivery-документи для планування реалізації.
3. `architecture/` - цільова архітектура рішення.

## Канонічні документи

### Requirements

- `00_source-of-truth_ua.md` - **ядро:** PDF + Excel як авторитет і мапа на UA-документи.
- `requirements/01_process-mapping_ua.md` - канонічний опис бізнес-процесу.
- `requirements/02_anamnese-flow_ua.md` - канонічні вимоги до анамнези і клінічного intake.
- `requirements/03_product-backlog_ua.md` - канонічний каталог функціонального scope.
- `requirements/04_non-functional-requirements_ua.md` - канонічні нефункціональні вимоги.

### Backlog

- `backlog/01_mvp-backlog_ua.md`
- `backlog/02_rbac-matrix_ua.md`
- `backlog/03_kpi-catalog_ua.md`
- `backlog/04_implementation-tasks_ua.md`

### Architecture

- `architecture/01_target-architecture_ua.md`

## Як читати документацію

Якщо треба зафіксувати, **що є джерелом правди** і як PDF/Excel пов’язані з `.md`:

- почни з `00_source-of-truth_ua.md`

Якщо треба зрозуміти узгоджені вимоги до продукту:

- працюй з `requirements/`

Якщо треба планувати реалізацію:

- працюй з `backlog/`

Якщо треба проєктувати систему:

- працюй з `architecture/`

## Джерела (оригінали)

У каталозі `docs/`:

| Файл | Зміст |
|------|--------|
| `1 (Update 2) User Story Salesforce.xlsx` | Аркуші **User Stories** (~184 рядки), **RBAC Matrix**, **KPIs** |
| `Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf` | Процесна карта клієнтського шляху (1 стор., flowchart) |
| `Allgemeine Anamnese (in Bearbeitung).pdf` | Flow анамнезу / маски кейсу (1 стор.) |

Повна мапа «оригінал → похідний документ», правила при конфліктах і таблиця EPIC 1–24 — у `00_source-of-truth_ua.md`.
