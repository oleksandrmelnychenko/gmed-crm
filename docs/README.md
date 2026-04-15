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
4. `testing/` - regression matrices, аудити трасованості Excel і current-state gap-аудити.

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

### Testing

- `testing/user-stories-excel-backlog-audit_ua.md` - аудит 1:1 між Excel `User Stories` і `requirements/03_product-backlog_ua.md`
- `testing/full-docs-backlog-reconciliation_ua.md` - повна звірка `requirements/`, `backlog/`, `architecture/`, planning docs і current-state коду
- `testing/04_rbac-e2e-test-plan_ua.md` - current-state RBAC / browser verification plan і правила coverage
- `testing/source-workspace-regression-matrix.md` - regression coverage по workspace slices
- `testing/source-billing-regression-matrix.md` - regression coverage по billing slice
- `testing/source-documents-regression-matrix.md` - regression coverage по documents slice
- `testing/current-state-gap-audit_ua.md` - робочий зріз того, що вже є в коді, а що ще лишається gap відносно source scope
- `testing/worktree-stabilization-inventory_ua.md` - інвентаризація незведеного worktree перед фінальним stabilization pass
- `testing/ui-rbac-route-guard-plan_ua.md` - план доведення staff shell і route guards до single source of truth

### Поточний Freeze Status

Станом на `2026-04-15` current-state зріз підтверджений повним freeze pass:

- `cargo fmt --all`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `frontend npm test`
- `frontend npm run lint`
- `frontend npm run build`
- `frontend npm run test:e2e` (`22/22`)
- `frontend npm run test:e2e:live` (`47/47`)

Детальний status і незакриті інтеграційні/engineering tails дивись у `testing/full-docs-backlog-reconciliation_ua.md` і `testing/current-state-gap-audit_ua.md`.
Для normalization / commit slicing / canonical test infra дивись `testing/worktree-stabilization-inventory_ua.md`.

Коротко по residual current-state на цьому зрізі:

- внутрішній core product уже практично закритий;
- реальний незакритий in-scope slice зараз переважно `AI / pseudonymization -> AI handoff`;
- решта великих незакритих пунктів це вже зовнішні інтеграції (`DATEV`, `E-Rechnung`, payment provider, `eIDAS/QES`) або engineering/stabilization tails.

## Як читати документацію

Якщо треба зафіксувати, **що є джерелом правди** і як PDF/Excel пов’язані з `.md`:

- почни з `00_source-of-truth_ua.md`

Якщо треба побачити **повну current-state звірку** між `docs/` і реальним кодом:

- почни з `testing/full-docs-backlog-reconciliation_ua.md`

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
