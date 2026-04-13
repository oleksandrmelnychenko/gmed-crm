# Worktree Stabilization Inventory (UA)

> Операційний зріз stabilization pass станом на **2026-04-13**. Це не backlog і не source-of-truth; файл потрібен, щоб було видно, як брудний worktree був зведений у bounded commits і що залишалось на момент фінального docs commit.

## Update: stabilization resolved into bounded commits

Під час stabilization pass незведений worktree був розкладений у такі bounded commits:

- `4cfd8e2` — `Harden portal messaging and document workflows`
- `22f6dea` — `Expand clinical subflows and provider analytics`
- `dd52b16` — `Polish appointment UX and frontend translations`

На момент оновлення цього файлу в dirty state лишався тільки `docs reconciliation / current-state docs` bucket.

## 1. Загальний стан

- Основні product / platform зміни вже рознесені по bounded commits.
- На момент фінального docs pass `git status` ще не чистий тільки через documentation sync.
- Основний ризик великого змішаного diff вже знято; далі важливо не повертатись до практики накопичення багатьох slices в один worktree.

## 2. Основні change-buckets

### 2.0 Current active buckets after narrowing

#### Portal messaging / document workflows

- commit `4cfd8e2`

Зміст:

- attachment-level `E2E`
- document file delete lifecycle
- provider cover-message requirement for shares
- patient/self-service and compliance revocation hardening
- frontend smoke harness for staff and portal

#### Clinical / analytics / RBAC hardening

- commit `22f6dea`

Зміст:

- `CEO Assistant` patient read policies
- specialty sub-flows `Gastroenterology / Orthopedics / Neurology / Pulmonology / Urology`
- provider reporting and feedback-quality KPI expansion
- RBAC regression hardening for `sales / it_admin / billing`

#### Appointment UX / translation sync

- commit `dd52b16`

Зміст:

- recurring appointment lineage and exclusion-constraint migration sync
- mobile interpreter agenda
- quick actions and recurrence UX polish
- frontend translation catalog sync for the touched workspaces

#### Docs reconciliation

- `docs/README.md`
- `docs/testing/full-docs-backlog-reconciliation_ua.md`

Статус:

- це був останній active bucket перед clean worktree

### 2.1 Clinical / patient workspace

- `crates/server/src/routes/cases.rs`
- `crates/server/src/routes/patients.rs`
- `crates/server/tests/workspace_filters_api.rs`
- `frontend/src/pages/cases.tsx`
- `frontend/src/pages/patient-detail.tsx`
- `migrations/20260412143000_case_doctor_fk_enrichment.sql`
- `migrations/20260412144500_case_referrer_doctor_fk.sql`
- `migrations/20260412160000_case_cardiology_subflow.sql`
- `migrations/20260413090000_case_retention_and_history_hardening.sql`

### 2.2 Process / appointments / orders

- `crates/server/src/routes/appointments.rs`
- `crates/server/src/routes/orders.rs`
- `crates/server/src/routes/tasks.rs`
- `crates/server/src/routes/workflow_checklists.rs`
- `crates/server/src/routes/workflow_lifecycle.rs`
- `crates/server/tests/appointments_portal_api.rs`
- `crates/server/tests/process_gates_api.rs`
- `crates/server/tests/workflow_checklists_api.rs`
- `frontend/src/pages/appointments.tsx`
- `frontend/src/pages/orders.tsx`
- `frontend/src/pages/patient-appointments.tsx`
- `migrations/20260411220000_workflow_checklists.sql`
- `migrations/20260411230000_order_process_gates.sql`
- `migrations/20260411300000_lead_failed_resolution_and_lifecycle.sql`
- `migrations/20260411310000_order_planning_preparation.sql`
- `migrations/20260411320000_order_execution_followup_flow.sql`
- `migrations/20260412153000_order_debt_management.sql`

### 2.3 Portal / documents / messaging / feedback

- `crates/server/src/routes/documents.rs`
- `crates/server/src/routes/messages.rs`
- `crates/server/src/routes/me.rs`
- `crates/server/src/routes/feedback.rs`
- `crates/server/tests/documents_api.rs`
- `crates/server/tests/me_api.rs`
- `crates/server/tests/messages_portal_api.rs`
- `crates/server/tests/feedback_api.rs`
- `frontend/src/pages/documents.tsx`
- `frontend/src/pages/chat.tsx`
- `frontend/src/pages/patient-documents.tsx`
- `frontend/src/pages/patient-dashboard.tsx`
- `frontend/src/pages/patient-services.tsx`
- `frontend/src/pages/feedback.tsx`
- `migrations/20260411170000_document_versioning.sql`
- `migrations/20260411173000_document_translation_requests.sql`
- `migrations/20260411190000_document_text_extraction_and_translation_workspace.sql`
- `migrations/20260411210000_patient_feedback_forms.sql`
- `migrations/20260411240000_direct_messages_gdpr_redaction.sql`
- `migrations/20260412123000_direct_messages_read_at.sql`
- `migrations/20260412180000_direct_messages_encryption.sql`

### 2.4 Providers / contracts / billing / analytics

- `crates/server/src/routes/providers.rs`
- `crates/server/src/routes/contracts.rs`
- `crates/server/src/routes/invoices.rs`
- `crates/server/src/routes/stats.rs`
- `crates/server/tests/contracts_quotes_api.rs`
- `crates/server/tests/invoices_api.rs`
- `crates/server/tests/stats_api.rs`
- `frontend/src/pages/providers.tsx`
- `frontend/src/pages/provider-detail.tsx`
- `frontend/src/pages/contracts.tsx`
- `frontend/src/pages/invoices.tsx`
- `frontend/src/pages/reports.tsx`
- `frontend/src/pages/dashboard.tsx`
- `migrations/20260411243000_provider_registry_enrichment.sql`
- `migrations/20260412113000_quote_versions.sql`
- `migrations/20260412173000_invoice_uniqueness_hardening.sql`

### 2.5 Auth / security / platform

- `crates/server/src/access.rs`
- `crates/server/src/auth/middleware.rs`
- `crates/server/src/auth/mod.rs`
- `crates/server/src/auth/tokens.rs`
- `crates/server/src/auth/blacklist.rs`
- `crates/server/src/crypto.rs`
- `crates/server/src/file_sniff.rs`
- `crates/server/src/config.rs`
- `crates/server/src/state.rs`
- `crates/server/src/main.rs`
- `crates/server/src/lib.rs`
- `migrations/20260412170000_revoked_access_tokens.sql`

### 2.6 Frontend shell / navigation

- `frontend/src/App.tsx`
- `frontend/src/components/layout.tsx`
- `frontend/src/components/nav-panel.tsx`
- `frontend/src/components/topbar.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/api/types.ts`
- `frontend/src/lib/i18n/index.ts`
- `frontend/src/lib/i18n/de.ts`
- `frontend/src/lib/i18n/ru.ts`

### 2.7 SQLx cache / env / toolchain

- `.env.example`
- `.sqlx/*`
- `Cargo.lock`
- `crates/server/Cargo.toml`

## 3. Що саме потребує stabilization

- Розвести `.sqlx` churn від feature changes. Якщо лишаємось у runtime-query strategy, треба не тримати випадкові масові delete/add cache-файлів у тому ж commit.
- Звести clinical/history slice окремо від auth/security slice.
- Перевірити, що всі нові міграції йдуть у правильному хронологічному порядку й не дублюють older schema steps.
- Після рознесення slices прогнати один суцільний pass:
  `cargo fmt --all`
  `cargo check -p gmed-server --tests`
  `cargo clippy -p gmed-server --all-targets -- -D warnings`
  `cargo test` по цільових integration suites
  `npm --prefix frontend run lint`
  `npm --prefix frontend run build`

## 4. Практичний порядок зведення

1. `clinical / case retention + history`
2. `process gates / orders / appointments`
3. `portal documents + messaging + feedback`
4. `reports / analytics / billing`
5. `auth / security / platform`
6. окремо `sqlx/toolchain` cleanup

## 5. Межі цього файлу

- Це не каже, що всі listed files проблемні; це лише інвентаризація незведених змін.
- Це не заміняє regression matrices.
- Це не заміняє `current-state-gap-audit_ua.md`; той файл про функціональні gaps, а цей про технічний стан worktree.
