# RBAC / E2E verification plan

> Документ більше **не описує greenfield-план "з нуля"**. Репозиторій уже має великий current-state шар інтеграційних, browser і helper-тестів. Нижче зафіксовано: що верифікаційно вже існує, що є джерелом правди, і який залишився **реальний** hardening backlog по RBAC.

## 1. Мета і scope

Цей документ задає порядок і правила для перевірки **ролей, прав доступу, assignment-scoping, share/release lifecycle і UI-shell обмежень**.

Фокус:
- backend route-level RBAC;
- field/data-sensitivity isolation;
- patient-bound / assignment-bound visibility;
- browser-level `hide / disable / redirect` поведінка;
- hardening решти клітинок матриці, які ще не мають explicit regression coverage.

Чому RBAC стоїть першим:
1. Це security baseline для GDPR / ISO 27001.
2. Це один з небагатьох шарів, де помилка майже завжди означає витік, а не просто UX-баг.
3. Current-state продукт уже широкий; без щільної RBAC-регресії будь-яка нова фіча легко ламає доступи в суміжних workspace-ах.

## 2. Джерела істини

Порядок авторитету не задається цим файлом довільно. Канонічне правило вже зафіксоване в [00_source-of-truth_ua.md](C:/Users/123/Downloads/dev/docs/00_source-of-truth_ua.md).

Практичний порядок для RBAC:
1. Оригінальні клієнтські файли в `docs/`:
   - [1 (Update 2) User Story Salesforce.xlsx](C:/Users/123/Downloads/dev/docs/1%20(Update%202)%20User%20Story%20Salesforce.xlsx)
   - [Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf](C:/Users/123/Downloads/dev/docs/Process%20Mapping%20(Kundenjourney%20allg.)(in%20Bearbeitung).pdf)
2. Канонічні похідні UA-документи:
   - [02_rbac-matrix_ua.md](C:/Users/123/Downloads/dev/docs/backlog/02_rbac-matrix_ua.md)
   - [03_product-backlog_ua.md](C:/Users/123/Downloads/dev/docs/requirements/03_product-backlog_ua.md)
   - [01_process-mapping_ua.md](C:/Users/123/Downloads/dev/docs/requirements/01_process-mapping_ua.md)
3. Поточна реалізація:
   - [role.rs](C:/Users/123/Downloads/dev/crates/domain/src/role.rs)
   - [policy.rs](C:/Users/123/Downloads/dev/crates/domain/src/access/policy.rs)
   - route-level policy helpers у server crate
4. Current-state evidence:
   - [source-workspace-regression-matrix.md](C:/Users/123/Downloads/dev/docs/testing/source-workspace-regression-matrix.md)
   - [source-documents-regression-matrix.md](C:/Users/123/Downloads/dev/docs/testing/source-documents-regression-matrix.md)
   - [source-billing-regression-matrix.md](C:/Users/123/Downloads/dev/docs/testing/source-billing-regression-matrix.md)
   - [current-state-gap-audit_ua.md](C:/Users/123/Downloads/dev/docs/testing/current-state-gap-audit_ua.md)
5. План доведення staff UI + маршрутів до single source of truth (меню = guard):
   - [ui-rbac-route-guard-plan_ua.md](C:/Users/123/Downloads/dev/docs/testing/ui-rbac-route-guard-plan_ua.md)

Правило просте:
- якщо код розходиться з оригіналом клієнта, адаптуємо код і тести;
- якщо secondary-doc розходиться з current-state кодом, спочатку з'ясовуємо чи це stale planning text, чи справжній product gap.

## 3. Нормалізована RBAC semantics

Для naming і coverage ми користуємось нормалізованими позначками, але **не дублюємо всю Excel-таблицю** вдруге в цьому файлі. Точне клієнтське формулювання вже є в [02_rbac-matrix_ua.md](C:/Users/123/Downloads/dev/docs/backlog/02_rbac-matrix_ua.md).

У тест-плані використовуємо такі коди:
- `✅ full` — read/write/manage без assignment обмеження;
- `👁️ read-only` — читання дозволено, мутації ні;
- `🎯 assigned-only` — потрібен patient/order/team assignment;
- `🟡 conditional` — доступ виникає тільки після `release / freigabe / share_status`;
- `✍️ write` — окремо дозволені mutation routes;
- `❌ denied` — доступ заборонений;
- `agg` — лише агрегати, без per-patient drill-down.

Окремо:
- `Role` мапиться на [role.rs](C:/Users/123/Downloads/dev/crates/domain/src/role.rs);
- `share/release` мапиться на [share_status.rs](C:/Users/123/Downloads/dev/crates/domain/src/access/share_status.rs);
- sensitivity gating мапиться на [policy.rs](C:/Users/123/Downloads/dev/crates/domain/src/access/policy.rs).

## 4. Тестова піраміда

### 4.1. Rust integration tests

Основний доказ для backend RBAC.

Що перевіряють:
- `auth middleware -> route -> policy -> DB`;
- role/assignment/share-status isolation;
- deny-path без data leakage;
- lifecycle transitions, якщо вони впливають на доступ.

Де живуть:
- `crates/server/tests/*_api.rs`
- harness: [support/mod.rs](C:/Users/123/Downloads/dev/crates/server/tests/support/mod.rs)

Current-state:
- це вже головний verification layer, не майбутній;
- у repo вже велика кількість `*_api.rs` regression tests по workspace, documents, invoices, contracts, compliance, stats, messaging, appointments, feedback.

### 4.2. Playwright E2E

Потрібні там, де важливий саме UI shell:
- таб прихований;
- кнопка disabled;
- deep-link нормалізується;
- route visible/hidden по ролі;
- portal/staff shell не показує зайвий surface.

Current-state:
- browser smoke/live already покриває patient portal, staff shell, documents release/revoke, template generation, recurring appointments (whole-series cancel + whole-series recurrence reshape), secure chat, lead conversion gate, patient profile role shell.
- browser live additionally покриває forbidden deep-link normalization для `patient_manager`, `ceo_assistant`, `billing`, `sales`, `concierge`, `it_admin`, `interpreter`, `patient` у [rbac-denied-routes.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/rbac-denied-routes.live.spec.ts), включно з explicit high-risk cells `sales -> /documents`, `sales -> /contracts`, `concierge -> /invoices`, `billing -> /cases`, `it_admin -> /patients|/cases|/reports|/documents`.
- На поточному freeze зрізі browser coverage теж повністю зелена: `frontend npm run test:e2e` = `22/22`, `frontend npm run test:e2e:live` = `47/47`.

### 4.3. Vitest frontend unit

Потрібні для pure helper логіки:
- `show/hide`;
- `disabled reason`;
- tab normalization;
- route resolution;
- role-based derived state.

Правило:
- якщо логіку можна винести в pure helper, краще спочатку винести, а потім покрити unit-тестом.

## 4.4. Канонічний test infra baseline

Цей файл більше не виходить з припущення, що harness ще треба придумати. Current-state baseline уже існує і має бути canonicalized, а не дубльований.

Rust integration baseline:

- [support/mod.rs](C:/Users/123/Downloads/dev/crates/server/tests/support/mod.rs)

Frontend live/browser baseline:

- [playwright.live.config.ts](C:/Users/123/Downloads/dev/frontend/playwright.live.config.ts)
- [tests/e2e-live/](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/)
- для rerun/debug є explicit hook `PLAYWRIGHT_LIVE_SKIP_SETUP=1`, якщо state вже materialize-ений вручну і треба прогнати окремий spec без повторного managed setup/teardown

Database provisioning semantics:

- `E2E_DATABASE_URL` або `DATABASE_URL` -> external DB
- інакше Docker fallback
- якщо ні external DB, ні Docker недоступні, Rust integration suites через `suite_context(...)` skip-аються, а не валять baseline panic-ом

Практичне правило:

- нові dedicated `*_api.rs` suites спираються на `support/mod.rs`;
- нові DB-backed browser proofs ідуть у `tests/e2e-live/`;
- якщо є overlap з existing umbrella suite, перед merge треба явно визначити `keep / merge / drop`, а не просто додавати ще один паралельний файл;
- повний normalization / commit-slicing inventory ведеться в [worktree-stabilization-inventory_ua.md](C:/Users/123/Downloads/dev/docs/testing/worktree-stabilization-inventory_ua.md).

## 5. Принцип coverage

Для кожної high-risk клітинки матриці потрібні мінімум дві асерції:

1. Positive:
   роль може зробити дозволену дію над дозволеним ресурсом.

2. Negative:
   роль не може зробити ту саму дію над чужим або нерозкритим ресурсом.

Додаткові вимоги:
- deny-path не повинен протікати полями;
- для patient-bound ресурсів перевіряємо і direct URL path, і list filtering;
- для UI shell перевіряємо не тільки hidden nav, а й forbidden deep-link;
- release-based доступи завжди тестуємо на обох станах: до release і після.

## 6. Current-state coverage і реальний залишок

### Phase 1. Auth + session hygiene

Статус: `integration + live API coverage complete` (UI-only MFA wizard не дублюється окремим сценарієм, бо approve йде через admin API)

Вже підтверджено:
- `logout` revoke current access token;
- `logout-all` revoke all token families;
- protected routes повертають `401` після revoke;
- login happy path (seeded `admin@gmed.de` + Argon2-користувачі), `unknown_email` / `wrong_password`, validation errors;
- inactive user (`forbidden`) і `locked_until` / auto-lockout після `max_failed_login_attempts`;
- refresh rotation, reuse старого refresh → `token_theft_detected`, подальший refresh у тій же родині → `session_revoked`;
- refresh validation / `invalid_token` для невідомого refresh;
- MFA: `mfa_pending` на login, `GET /auth/pending/{id}` (`pending` → `approved` / `rejected`), approve через `POST /admin/mfa/pending/{id}/approve`, видача токенів і успішний `GET /auth/sessions`.

Джерело:
- [auth_sessions_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/auth_sessions_api.rs)
- Live API smoke: [auth-sessions.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/auth-sessions.live.spec.ts) (wrong password, login + refresh + theft на реальному бекенді з bootstrap)

Що лишається опційно (нижчий ROI):
- окремий Playwright **UI**-сценарій для форми логіна + MFA pending (зараз покрито HTTP + Rust);
- refresh rotation / **theft** unit edge cases поза happy path, якщо з’являться нові policy knobs;
- явні тести на `refresh` з простроченим refresh (потрібна маніпуляція часу/expiry у harness).

### Phase 2. Per-role smoke

Статус: `partial-high-risk covered`

Вже підтверджено:
- `sales` deny на patient/documents/chat/internal analytics surfaces;
- `CEO Assistant` read-only commercial scope;
- deny на appointments для `sales`, `billing`, `ceo_assistant`, `it_admin`;
- deny на feedback для нерелевантних ролей;
- operational/dashboard/report access для релевантних ролей.

Що ще лишилось:
- системно пройти по решті ролей у форматі `sees own` / `denied foreign`;
- добити пару broad shell smoke-сценаріїв по навігації.

### Phase 3. Patient data RBAC

Статус: `partial baseline exists`

Вже підтверджено:
- assignment-based patient visibility;
- `ceo_assistant` field-filtered/read-only scope;
- `patient_manager` patient-bound export/privacy/label flows;
- patient-profile shell не обходить backend policy через tabs/deep-links.

Що лишилось:
- більш повна create/update/delete матриця;
- додаткові field-level assertions для `concierge`, `billing`, `interpreter`;
- систематичний deny matrix по foreign patient detail/update paths.

### Phase 4. Documents / release / translation / provider-share

Статус: `strong current-state coverage`

Вже підтверджено:
- internal vs released vs patient-visible document access;
- portal release/revoke;
- provider share/revoke;
- translation request history / read-only executive scope;
- `patient_manager` assignment-bound share routes;
- browser smoke для release/revoke, template generation, patient receipt confirmation, self-upload/re-download.

Що лишилось:
- не базова RBAC відсутність, а лише ущільнення audit/log/deny-path сценаріїв.

### Phase 5. Appointments / interpreter

Статус: `strong current-state coverage`

Вже підтверджено:
- role-gated appointment workspace;
- recurring series lifecycle;
- interpreter/teamlead visibility boundaries;
- portal appointment requests;
- mobile agenda / interpreter shell;
- browser smoke на recurring operations.

Що лишилось:
- глибше покриття hour-approval/team-bound edge-cases;
- додаткові deny-path tests по team separation.

### Phase 6. Financial isolation

Статус: `strong current-state coverage`

Вже підтверджено:
- invoices RBAC;
- patient own invoice surface;
- `CEO` full, `CEO Assistant` read-only, `billing` manage, `sales/concierge` deny;
- sales-safe aggregate-only analytics;
- billing KPI/report layer.

Що лишилось:
- exhaustiveness на решту CRUD клітинок;
- regulatory/tax assertions лише там, де сама бізнес-логіка вже реально існує.

### Phase 7. Lead conversion

Статус: `partial-high coverage`

Вже підтверджено:
- readiness gates;
- failed lead flow;
- blocked vs ready convert state на browser-level;
- order / re-check dependencies.

Що лишилось:
- розширити matrix по кожному missing-field reason;
- якщо продукт окремо зафіксує нові gateway rules, додати explicit route tests під них.

### Phase 8. Communication / messaging

Статус: `strong current-state coverage`

Вже підтверджено:
- patient/staff chat scope;
- allowed-peer filtering;
- `sales` deny на internal chat;
- secure text + attachment browser flows;
- portal messaging scope.

Що лишилось:
- глибше покриття redaction / malicious upload / per-role mutation edges.

### Phase 9. Admin / compliance

Статус: `strong current-state coverage`

Вже підтверджено:
- privacy request workflow;
- consent revoke;
- export / anonymize;
- `it_admin` deny на production patient data surfaces;
- audit/compliance role boundaries.

Що лишилось:
- додаткові explicit tests на audit-log content boundaries;
- auto-purge / retention scheduler coverage там, де route або job already існує.

### Phase 10. UI shell

Статус: `strong current-state coverage`

Вже підтверджено:
- patient profile shell;
- lead convert gating;
- documents/invoices/contracts read-only surfaces;
- patient portal nav;
- recurring appointments browser flow, включно з whole-series rule reshape;
- secure chat browser flow.

Що лишилось:
- не новий shell, а поступове добивання решти hidden/disabled cells з RBAC matrix.

## 7. Fixtures і helpers

Current-state уже інший, ніж описувався в старому плані.

Що є зараз:
- [support/mod.rs](C:/Users/123/Downloads/dev/crates/server/tests/support/mod.rs) уже піднімає `suite_context`;
- harness сам резолвить БД через:
  - `TEST_DATABASE_ADMIN_URL`,
  - або `DATABASE_URL`,
  - або Docker fallback (`postgres:16-alpine`);
- seeded admin already є через міграції.

Що **не відповідає** старому формулюванню:
- repo зараз **не має** одного централізованого набору `seed_*` helper-ів у `support/mod.rs`;
- натомість seed-функції розподілені по конкретних `*_api.rs` файлах.

Що варто робити далі:
- не блокувати нові тести великим refactor-ом;
- поступово витягувати у shared layer ті helper-и, які вже повторюються в 3+ test files.

Перші кандидати на консолідацію:
- `seed_user_with_password`
- `login_as`
- `issue_token_for`
- `seed_patient_with_assignments`
- `seed_lead`
- `seed_invoice_for_patient`
- `seed_document`
- `seed_appointment`

Правила для shared fixtures:
1. Повертають `id`, а не готові DTO.
2. Не викликають приховано інші seed-функції без явної потреби тесту.
3. Працюють із `TestSuiteContext` без глобального mutable state.

## 8. Відкриті бізнес-неоднозначності

Ці питання не блокують поточний baseline, але важливі для **exhaustive matrix hardening**:

1. `Sales + Finanzen = Auswertung und Analyse`
   Поточна безпечна інтерпретація: лише агрегати, не per-invoice read.

2. `Sales + Termine = Teilzugriff zur Auswertung`
   Поточна безпечна інтерпретація: тільки aggregate/velocity view, не per-appointment detail.

3. `CEO + Dolmetscherberichte = Lesen`
   Якщо замовник реально хоче жорсткий read-only even for CEO, це треба явно перевірити проти current route policy, бо багато current-state executive surfaces уже ширші.

4. `IT-Admin + Patientendaten = Testdaten only`
   У current schema немає технічної межі між test/prod rows. Безпечна current-state інтерпретація: повний deny на production patient rows.

## 9. ROI і порядок добивки

Початковий оцінний "230 тестів / 30-37 днів" був би релевантний для greenfield-проєкту. Для цього repo він уже застарілий.

Реальний порядок зараз такий:
1. Добити auth/session matrix.
2. Добити systematic per-role smoke там, де coverage ще implicit, а не explicit.
3. Ущільнити patient/data field-level deny assertions.
4. Ущільнити browser shell coverage для решти roles/cells.
5. Паралельно витягувати shared fixtures з повторюваних test files.

Оптимальна точка ROI:
- не переписувати все "по фазах з нуля";
- добивати тільки решту клітинок, яких ще немає в regression matrices.

## 10. Як запускати

```bash
# опційно: якщо хочеш зафіксований локальний postgres
docker compose up -d db

# env vars, якщо не використовуєш docker fallback з harness
export DATABASE_URL=postgres://gmed:gmed@localhost:5432/gmed
export TEST_DATABASE_ADMIN_URL=postgres://gmed:gmed@localhost:5432/postgres

# окремий Rust integration file
cargo test -p gmed-server --test auth_sessions_api

# усі server integration tests
cargo test -p gmed-server --tests

# frontend unit
npm --prefix frontend run test

# browser
npm --prefix frontend run test:e2e
```

Важливий current-state факт:
- CI в [ci.yml](C:/Users/123/Downloads/dev/.github/workflows/ci.yml) уже виконує `cargo test --workspace`;
- integration tests **більше не залежать тільки від** `TEST_DATABASE_ADMIN_URL`, бо [support/mod.rs](C:/Users/123/Downloads/dev/crates/server/tests/support/mod.rs) має `DATABASE_URL` і Docker fallback.

Що все ще можна покращити:
- додати окремий `rust-integration` job з explicit Postgres service;
- це не тому, що тести зараз "silently skip", а для детермінізму, швидшого cold start і яснішої ізоляції CI failure-ів.

## 11. Пов’язані документи

- [00_source-of-truth_ua.md](C:/Users/123/Downloads/dev/docs/00_source-of-truth_ua.md)
- [02_rbac-matrix_ua.md](C:/Users/123/Downloads/dev/docs/backlog/02_rbac-matrix_ua.md)
- [03_kpi-catalog_ua.md](C:/Users/123/Downloads/dev/docs/backlog/03_kpi-catalog_ua.md)
- [current-state-gap-audit_ua.md](C:/Users/123/Downloads/dev/docs/testing/current-state-gap-audit_ua.md)
- [full-docs-backlog-reconciliation_ua.md](C:/Users/123/Downloads/dev/docs/testing/full-docs-backlog-reconciliation_ua.md)
- [source-workspace-regression-matrix.md](C:/Users/123/Downloads/dev/docs/testing/source-workspace-regression-matrix.md)
- [source-documents-regression-matrix.md](C:/Users/123/Downloads/dev/docs/testing/source-documents-regression-matrix.md)
- [source-billing-regression-matrix.md](C:/Users/123/Downloads/dev/docs/testing/source-billing-regression-matrix.md)
