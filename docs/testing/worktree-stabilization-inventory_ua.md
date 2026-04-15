# Worktree Stabilization Inventory (UA)

> Операційний зріз normalization / commit-slicing pass станом на **2026-04-15**. Це не backlog і не source-of-truth; файл потрібен, щоб видно було: який dirty tree реально є, які test infra артефакти треба канонізувати, і як різати це в bounded commits без змішування контурів.

## 1. Поточний стан

- Репозиторій функціонально сильно просунутий, але `git status` лишається великим і змішаним.
- Основний ризик зараз не у відсутності фіч, а в тому, що:
  - частина integration / live test infrastructure ще `untracked`;
  - частина dedicated suites перекривається з великим umbrella-файлом [workspace_filters_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/workspace_filters_api.rs);
  - frontend live E2E harness уже став базовим verification layer, але ще не оформлений як канонічна частина baseline.
- Отже stabilization тепер означає не “ще один великий freeze”, а:
  1. зафіксувати canonical test infra,
  2. відокремити real dedicated suites від дублю,
  3. нарізати продуктове дерево на bounded commits.

## 2. Canonical Test Infra Baseline

### 2.1 Rust integration support

Канонічний shared harness:

- [support/mod.rs](C:/Users/123/Downloads/dev/crates/server/tests/support/mod.rs)

Що це вже робить:

- ізольовані suite-level Postgres databases;
- fallback порядок `TEST_DATABASE_ADMIN_URL -> DATABASE_URL -> docker postgres:16-alpine`;
- загальний `suite_context(...)` для Axum app + pool + seeded admin;
- якщо external DB не задано і Docker недоступний, `suite_context(...)` тепер повертає `None`, а не панікує, щоб DB-backed suites чесно skip-ались у non-DB середовищі;
- `wait_until(...)` для async side-effects типу audit / notifications.

Правило:

- нові dedicated Rust integration suites мають спиратися саме на цей harness;
- ad-hoc локальні bootstrap helpers поза `support/mod.rs` не множимо;
- якщо потрібні нові test helpers, розширюємо `support/mod.rs`, а не копіюємо seed-логіку по файлах.

### 2.2 Frontend live browser harness

Канонічний live harness:

- [playwright.live.config.ts](C:/Users/123/Downloads/dev/frontend/playwright.live.config.ts)
- [global-setup.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/support/global-setup.ts)
- [global-teardown.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/support/global-teardown.ts)
- [live-helpers.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/support/live-helpers.ts)
- [process-state.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/support/process-state.ts)
- [runtime.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/support/runtime.ts)

Що це вже покриває:

- живий backend + frontend stack;
- bootstrap сценарії з seeded users/patient/order/invoice/appointment/documents;
- DB-backed Playwright proofs для staff, patient portal, auth, chat, appointments, compliance, commercial.
- database provisioning вирівняне під Rust support semantics:
  `E2E_DATABASE_URL / DATABASE_URL -> external DB`, інакше Docker fallback.

Правило:

- `tests/e2e-live/**` більше не вважаються локальним експериментом;
- усі нові live browser proofs для закритих backlog slices мають іти саме сюди;
- нові одноразові `playwright` конфіги не додаємо без окремої причини.

## 3. Keep / Reconcile / Drop по test suites

### 3.1 Keep as canonical dedicated suites

Ці файли мають сенс лишити окремими canonical suites, а не зливати назад в umbrella:

- [admin_security_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/admin_security_api.rs)
  - унікальний admin audit analytics slice;
- [case_anamnesis_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/case_anamnesis_api.rs)
  - cleaner dedicated EPIC 2 suite, сильніший за випадкове розмазування по umbrella;
- [provider_templates_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/provider_templates_api.rs)
  - окремий provider-template CRUD/generation slice;
  - auto-send proof canonicalized elsewhere in [documents_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/documents_api.rs);
- [auth-sessions.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/auth-sessions.live.spec.ts)
- [patient-portal.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/patient-portal.live.spec.ts)
- [staff-workflows.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/staff-workflows.live.spec.ts)
- [rbac-denied-routes.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/rbac-denied-routes.live.spec.ts)

### 3.2 Reconcile before canonicalizing

Ці файли не можна просто “визнати baseline” без звірки з tracked coverage:

- [patient_registry_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/patient_registry_api.rs)
  - виявився повним parallel duplicate до tracked patient-registry block у [workspace_filters_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/workspace_filters_api.rs);
  - рішення: **drop** як untracked дубль, поки немає окремого bounded refactor-а по витягуванню EPIC 1 suite з umbrella;
- [provider_detail_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/provider_detail_api.rs)
  - виявився duplicate до tracked provider detail coverage в [workspace_filters_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/workspace_filters_api.rs);
  - рішення: **drop** як untracked дубль;
- [staff-route-access.ts](C:/Users/123/Downloads/dev/frontend/src/lib/staff-route-access.ts)
- [staff-route-access.test.ts](C:/Users/123/Downloads/dev/frontend/src/lib/staff-route-access.test.ts)
- [use-staff-navigate.ts](C:/Users/123/Downloads/dev/frontend/src/lib/use-staff-navigate.ts)
- [staff-link.tsx](C:/Users/123/Downloads/dev/frontend/src/components/staff-link.tsx)
  - це правильний напрямок для canonical route-guard layer, але треба дорізати як окремий shell/RBAC commit, не змішувати з product slices.

### 3.3 Not drop, but explicitly treat as baseline docs

- [04_rbac-e2e-test-plan_ua.md](C:/Users/123/Downloads/dev/docs/testing/04_rbac-e2e-test-plan_ua.md)
- [ui-rbac-route-guard-plan_ua.md](C:/Users/123/Downloads/dev/docs/testing/ui-rbac-route-guard-plan_ua.md)
- [phase-f-ssot-drift-audit.md](C:/Users/123/Downloads/dev/docs/testing/phase-f-ssot-drift-audit.md)

Це не “локальні нотатки”, а потрібні control docs для normalization і verification density.

## 4. Поточні dirty buckets

### 4.1 Domain / role / shell guard

- [policy.rs](C:/Users/123/Downloads/dev/crates/domain/src/access/policy.rs)
- [role.rs](C:/Users/123/Downloads/dev/crates/domain/src/role.rs)
- [staff-route-access.ts](C:/Users/123/Downloads/dev/frontend/src/lib/staff-route-access.ts)
- [use-staff-navigate.ts](C:/Users/123/Downloads/dev/frontend/src/lib/use-staff-navigate.ts)
- [staff-link.tsx](C:/Users/123/Downloads/dev/frontend/src/components/staff-link.tsx)
- related tests under `frontend/src/lib/*staff*`

Це окремий `RBAC shell normalization` bucket.

### 4.2 Test infra canonicalization

- [support/mod.rs](C:/Users/123/Downloads/dev/crates/server/tests/support/mod.rs)
- [playwright.live.config.ts](C:/Users/123/Downloads/dev/frontend/playwright.live.config.ts)
- [tests/e2e-live/](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/)
- [scripts/](C:/Users/123/Downloads/dev/frontend/scripts/)
- [e2e_support.rs](C:/Users/123/Downloads/dev/crates/server/src/routes/e2e_support.rs)

Це окремий `test infrastructure baseline` bucket.

### 4.3 Dedicated Rust suites

- [case_anamnesis_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/case_anamnesis_api.rs)
- [provider_templates_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/provider_templates_api.rs)
- [admin_security_api.rs](C:/Users/123/Downloads/dev/crates/server/tests/admin_security_api.rs)

Це окремий `dedicated suites normalization` bucket.

### 4.4 Clinical / patient enrichment

- [cases.rs](C:/Users/123/Downloads/dev/crates/server/src/routes/cases.rs)
- [patients.rs](C:/Users/123/Downloads/dev/crates/server/src/routes/patients.rs)
- [patient-detail.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/patient-detail.tsx)
- [cases.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/cases.tsx)
- [cases.snippets.ts](C:/Users/123/Downloads/dev/frontend/src/pages/cases.snippets.ts)
- [cases.snippets.test.ts](C:/Users/123/Downloads/dev/frontend/src/pages/cases.snippets.test.ts)
- [cases.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/cases.live.spec.ts)
- patient-clinical migrations from:
  - [20260414110000_patient_vitals_and_clinical_warnings.sql](C:/Users/123/Downloads/dev/migrations/20260414110000_patient_vitals_and_clinical_warnings.sql)
  - [20260414123000_patient_card_entries.sql](C:/Users/123/Downloads/dev/migrations/20260414123000_patient_card_entries.sql)
  - [20260414130000_patient_medical_orders.sql](C:/Users/123/Downloads/dev/migrations/20260414130000_patient_medical_orders.sql)
  - [20260414134000_patient_risk_scores.sql](C:/Users/123/Downloads/dev/migrations/20260414134000_patient_risk_scores.sql)
  - [20260415100000_case_text_snippets.sql](C:/Users/123/Downloads/dev/migrations/20260415100000_case_text_snippets.sql)

### 4.5 Process / appointments / portal conversion

- [appointments.rs](C:/Users/123/Downloads/dev/crates/server/src/routes/appointments.rs)
- [orders.rs](C:/Users/123/Downloads/dev/crates/server/src/routes/orders.rs)
- [leads.rs](C:/Users/123/Downloads/dev/crates/server/src/routes/leads.rs)
- [appointments.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/appointments.tsx)
- [patient-appointments.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/patient-appointments.tsx)
- [patient-portal.shared.ts](C:/Users/123/Downloads/dev/frontend/src/pages/patient-portal.shared.ts)
- migrations:
  - [20260414133000_appointment_schedule_constraints_deferrable.sql](C:/Users/123/Downloads/dev/migrations/20260414133000_appointment_schedule_constraints_deferrable.sql)
  - [20260415113000_appointment_care_path_kind.sql](C:/Users/123/Downloads/dev/migrations/20260415113000_appointment_care_path_kind.sql)

### 4.6 Documents / provider templates / portal release

- [documents.rs](C:/Users/123/Downloads/dev/crates/server/src/routes/documents.rs)
- [provider-detail.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/provider-detail.tsx)
- [documents.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/documents.tsx)
- [patient-portal.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/patient-portal.live.spec.ts)
- [staff-workflows.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/staff-workflows.live.spec.ts)
- migrations:
  - [20260414090000_provider_templates.sql](C:/Users/123/Downloads/dev/migrations/20260414090000_provider_templates.sql)
  - [20260415093000_order_leistung_supporting_documents.sql](C:/Users/123/Downloads/dev/migrations/20260415093000_order_leistung_supporting_documents.sql)
  - [20260415103000_provider_template_auto_send.sql](C:/Users/123/Downloads/dev/migrations/20260415103000_provider_template_auto_send.sql)

### 4.7 Billing / accounting / commercial catalog

- [contracts.rs](C:/Users/123/Downloads/dev/crates/server/src/routes/contracts.rs)
- [invoices.rs](C:/Users/123/Downloads/dev/crates/server/src/routes/invoices.rs)
- [orders.rs](C:/Users/123/Downloads/dev/crates/server/src/routes/orders.rs)
- [contracts.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/contracts.tsx)
- [invoices.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/invoices.tsx)
- [orders.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/orders.tsx)
- migrations:
  - [20260414143000_external_invoices.sql](C:/Users/123/Downloads/dev/migrations/20260414143000_external_invoices.sql)
  - [20260414150000_agency_service_catalog.sql](C:/Users/123/Downloads/dev/migrations/20260414150000_agency_service_catalog.sql)
  - [20260414152000_interpreter_report_billing_sync.sql](C:/Users/123/Downloads/dev/migrations/20260414152000_interpreter_report_billing_sync.sql)
  - [20260414160000_accounting_entries.sql](C:/Users/123/Downloads/dev/migrations/20260414160000_accounting_entries.sql)

### 4.8 Analytics / admin-security / docs

- [stats.rs](C:/Users/123/Downloads/dev/crates/server/src/routes/stats.rs)
- [admin_security.rs](C:/Users/123/Downloads/dev/crates/server/src/routes/admin_security.rs)
- [dashboard.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/dashboard.tsx)
- [reports.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/reports.tsx)
- docs under:
  - [current-state-gap-audit_ua.md](C:/Users/123/Downloads/dev/docs/testing/current-state-gap-audit_ua.md)
  - [full-docs-backlog-reconciliation_ua.md](C:/Users/123/Downloads/dev/docs/testing/full-docs-backlog-reconciliation_ua.md)
  - [source-workspace-regression-matrix.md](C:/Users/123/Downloads/dev/docs/testing/source-workspace-regression-matrix.md)
  - [source-documents-regression-matrix.md](C:/Users/123/Downloads/dev/docs/testing/source-documents-regression-matrix.md)
  - [source-billing-regression-matrix.md](C:/Users/123/Downloads/dev/docs/testing/source-billing-regression-matrix.md)

## 4.9 Verification Snapshot (2026-04-15)

Після normalization-проходу й live DB-backed reruns:

- `clinical / patient enrichment` — підтверджено:
  - Rust exact tests: `patient_vitals_*`, `patient_card_entries_*`, `patient_medical_orders_*`, `patient_risk_scores_*`, `case_text_snippets_*`
  - frontend helper proof: [cases.snippets.test.ts](C:/Users/123/Downloads/dev/frontend/src/pages/cases.snippets.test.ts)
  - live browser proof: [cases.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/cases.live.spec.ts)
- `process / appointments / portal conversion` — підтверджено:
  - Rust exact tests: `care_path_kind`, portal request conversion, lead gate conversion, planning/execution/followup, existing-customer re-check
  - live browser proof: [leads.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/leads.live.spec.ts), [patients.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/patients.live.spec.ts)
- `documents / provider templates / portal release` — підтверджено:
  - Rust exact tests: list filters, provider share, translation flow, visa template, auto-send, portal release/revoke
  - live browser proof: [staff-workflows.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/staff-workflows.live.spec.ts), [patient-portal.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/patient-portal.live.spec.ts)
- `billing / accounting / commercial` — підтверджено:
  - Rust exact tests: agency catalog, external invoices, overdue scheduler, auto-billed interpreter/medical lines, accounting ledger, invoice pagination
  - live browser proof: [appointments-staff.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/appointments-staff.live.spec.ts), [patient-portal.live.spec.ts](C:/Users/123/Downloads/dev/frontend/tests/e2e-live/patient-portal.live.spec.ts)
- `analytics / admin-security` — підтверджено:
  - Rust exact tests: audit analytics, reports sections, role KPI scorecards, forecasting, package-end forecasting, risk analysis
  - frontend proof: lint pass for [dashboard.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/dashboard.tsx), [reports.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/reports.tsx), [admin-security.tsx](C:/Users/123/Downloads/dev/frontend/src/pages/admin-security.tsx)

Практичний висновок:
- технічний фокус тепер уже не на feature proof, а на `bounded commit slicing`.

## 5. Commit slicing order

Практичний порядок, який мінімізує конфлікти і не бреше про baseline:

1. `test infra baseline`
   - shared Rust support
   - live Playwright harness
   - e2e support backend route
2. `RBAC shell normalization`
   - domain policy / role drift
   - staff route helpers / navigation guards / staff link
3. `dedicated suite canonicalization`
   - `admin_security_api`
   - `case_anamnesis_api`
   - `provider_templates_api`
   - explicit drop of duplicate `patient_registry_api`
   - explicit drop of duplicate `provider_detail_api`
4. `clinical patient enrichment`
   - vitals / warnings / card entries / medical orders / risk scores / text snippets
5. `process and appointments`
   - schedule constraints
   - care-path semantics
   - leads / patient portal conversion flow
6. `documents and provider template delivery`
   - provider templates
   - auto-send
   - patient receipt live/browser proof
7. `billing / accounting / commercial`
   - external invoices
   - agency service catalog
   - interpreter billing sync
   - accounting entries
8. `analytics + docs reconciliation`
   - stats/admin-security/report surfaces
   - final docs sync only after previous slices settle

## 6. Що не робити

- Не міксувати `test infra baseline` з великими feature commits.
- Не комітити `untracked` dedicated suites як “доказ закритого EPIC”, поки не зрозуміло що в них унікальне, а що дублює umbrella.
- Не зливати live harness у загальний frontend feature commit; це окремий infra layer.
- Не читати цей файл як product backlog. Він лише про технічне зведення дерева.

## 7. Definition of done для normalization

Normalization вважається завершеною тільки якщо:

- всі `untracked` canonical test infra файли заведені або явно відкинуті;
- дубльовані test suites мають зафіксоване рішення `keep / merge / drop`;
- dirty tree розкладений по bounded commits без cross-slice змішування;
- docs прямо фіксують canonical verification baseline;
- після цього проходить один суцільний verification pass:
  - `cargo fmt --all`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo test --workspace`
  - `npm --prefix frontend run lint`
  - `npm --prefix frontend run test`
  - `npm --prefix frontend run build`
  - `npm --prefix frontend run test:e2e`
  - `npm --prefix frontend run test:e2e:live`

## 8. Known Environment Caveat

- На Windows після серії Rust test runs інколи лишається живий локальний процес [gmed-server.exe](C:/Users/123/Downloads/dev/target/debug/gmed-server.exe), який блокує `cargo` під час наступної компіляції (`Access is denied` на remove file).
- Це не product regression і не test assertion failure. Поки що practical workaround — прибрати завислий процес перед rerun.
