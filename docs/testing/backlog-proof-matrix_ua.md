# Backlog Proof Matrix (UA)

> Канонічна матриця `backlog -> proof` станом на **2026-04-15**. Цей файл читається разом з [`docs/backlog/01_mvp-backlog_ua.md`](../backlog/01_mvp-backlog_ua.md) і показує не “що колись планувалось”, а який тип доказу вже є для кожного MVP epic:
>
> - `Rust` — DB-backed integration / scheduler / RBAC proof
> - `Live` — DB-backed Playwright browser proof
> - `Unit` — helper / policy / route-guard proof
>
> Правило просте: для user-facing потоку нормальний current-state означає не тільки backend regression, а й browser proof. Для pure backend slices `Rust` може бути достатнім, якщо окремого browser surface немає.

## 1. Статуси

- `Confirmed` — implemented scope має адекватний proof (`Rust`, а для user-facing path ще й `Live`)
- `Partial` — core scope є, але або browser proof ще нещільний, або epic містить зовнішні інтеграції / optional extensions поза поточним current-state
- `Gap` — реалізація або proof для epic реально відсутні

## 2. Matrix by MVP Epic

| Epic | Scope from backlog | Rust / DB proof | Live / browser proof | Status | Реальний залишок |
|------|---------------------|-----------------|----------------------|--------|------------------|
| `F1 Identity, RBAC, Audit` | roles, need-to-know, audit, MFA, privacy | `auth_sessions_api.rs`, `admin_mfa_api.rs`, `admin_compliance_api.rs`, `admin_security_api.rs`, `workspace_filters_api.rs` | `auth-sessions.live.spec.ts`, `auth-mfa-login-ui.live.spec.ts`, `rbac-denied-routes.live.spec.ts`, `compliance.live.spec.ts` | `Confirmed` | exhaustive matrix hardening only |
| `F2 Core Reference Data` | countries/languages/categories, providers, base templates/text blocks | `provider_catalog_api.rs`, `provider_templates_api.rs`, `documents_api.rs`, `contracts_quotes_api.rs` | `providers.live.spec.ts`, `staff-workflows.live.spec.ts` (provider templates), `commercial.live.spec.ts` | `Confirmed` | none inside current internal scope |
| `R1 Patient Registry` | patient create, demographics, related people, legal/compliance visibility | `workspace_filters_api.rs`, `patient_clinical_api.rs`, `me_api.rs`, `documents_api.rs` | `patients.live.spec.ts`, `patient-portal.live.spec.ts` | `Confirmed` | none inside internal scope |
| `R2 Medical Anamnesis` | case create, repeatable sections, specialty subflows, section completion | `case_anamnesis_api.rs`, `workspace_filters_api.rs`, `patient_clinical_api.rs` | `cases.live.spec.ts`, `patients.live.spec.ts` | `Confirmed` | specialty-library growth only, not blocker |
| `R3 Lead and Order Intake` | lead capture, compliance/document gates, conversion, first order/quote, PM assignment | `leads_api.rs`, `process_gates_api.rs`, `workflow_checklists_api.rs`, `contracts_quotes_api.rs` | `leads.live.spec.ts`, `patients.live.spec.ts`, `commercial.live.spec.ts` | `Confirmed` | none inside internal scope |
| `R4 Appointment Orchestration` | medical appointments, order link, plan PDF, conflicts, reminders/checklists | `appointment_care_path_api.rs`, `appointments_portal_api.rs`, `workflow_checklists_api.rs`, `process_gates_api.rs` | `appointments-staff.live.spec.ts`, `appointments-recurring.live.spec.ts`, `patient-portal.live.spec.ts` | `Confirmed` | optional richer preventive-program model only |
| `R5 Interpreter and Concierge Operations` | interpreter assignment, briefing, travel/concierge ops, interpreter hours/costs | `appointment_care_path_api.rs`, `workspace_filters_api.rs`, `messages_portal_api.rs`, `provider_catalog_api.rs` | `appointments-staff.live.spec.ts`, `patient-portal.live.spec.ts`, `chat-secure.live.spec.ts` | `Confirmed` | none inside internal scope |
| `R6 Document Flow` | upload, classify, share, provider-only medical share, missing-document alerts | `documents_api.rs`, `provider_templates_api.rs`, `me_api.rs` | `staff-workflows.live.spec.ts`, `patient-portal.live.spec.ts` | `Confirmed` | none inside internal scope |
| `R7 Billing and Cost Control` | billing aggregation, quotes/invoices/dunning, interpreter+concierge passthrough, debts, accounting export | `invoices_api.rs`, `external_invoices_api.rs`, `provider_catalog_api.rs`, `medication_expiry_api.rs`, `contracts_quotes_api.rs` | `commercial.live.spec.ts`, `appointments-staff.live.spec.ts`, `patient-portal.live.spec.ts` | `Partial` | `DATEV`, `E-Rechnung`, real payment settlement/provider checkout remain open |
| `R8 Patient Portal` | released-only visibility, uploads, plans/docs/invoices/appointments, eSign, payments | `me_api.rs`, `appointments_portal_api.rs`, `messages_portal_api.rs`, `feedback_api.rs`, `documents_api.rs` | `patient-portal.live.spec.ts`, `chat-secure.live.spec.ts` | `Partial` | `eIDAS/QES` and real checkout/payment provider remain open |
| `R9 Communication` | internal case comms, clinic/provider comms, tasks, secure patient messaging | `messages_api.rs`, `messages_portal_api.rs`, `feedback_api.rs`, `workflow_checklists_api.rs` | `chat-secure.live.spec.ts`, `staff-workflows.live.spec.ts`, `patient-portal.live.spec.ts` | `Confirmed` | none inside internal scope |
| `R10 KPI and CEO Dashboard` | CEO dashboard, role KPI, clinic/doctor efficiency reports | `stats_api.rs`, `admin_security_api.rs` | `analytics.live.spec.ts` | `Confirmed` | predictive / AI-style analytics remain outside this MVP epic |
| `R11 SOP and Learning` | SOP library, acknowledgement, local creation with approval | `sops_api.rs` | `sops.live.spec.ts` | `Confirmed` | none inside current internal scope |
| `R12 AI Readiness` | medical-data preparation, pseudonymization/anonymization, controlled AI contour | privacy/anonymization backend pieces only; no bounded AI handoff suite | none | `Gap` | `AI / pseudonymization -> AI handoff` remains the main internal product gap if AI is still in scope |

## 3. Current Priority Order After This Matrix

Є два коректні режими читання цієї матриці:

1. Якщо `AI` лишається в scope, наступний реальний `product gap` — `R12 AI Readiness`.
2. Якщо `AI` і зовнішні інтеграції свідомо виключені з поточного delivery scope, нових внутрішніх `product gaps` після цієї матриці вже не лишається.

У другому режимі правильний next track такий:

1. `regression / proof hardening`
2. `exhaustive RBAC matrix density`
3. `browser mutation coverage`
4. `commit hygiene / freeze discipline`

Зовнішні інтеграції поза current internal scope:

- `DATEV`
- `E-Rechnung`
- real payment checkout / settlement
- `eIDAS / QES`

## 4. Як користуватись цією матрицею

- Якщо user story вже `Confirmed`, наступна робота — це лише hardening або extension, а не “вигадати нову фічу”.
- Якщо epic `Partial`, треба відрізняти:
  - `proof gap` — є код, бракує канонічного browser/integration proof
  - `product gap` — коду реально немає
- Якщо epic `Gap`, це вже bounded implementation work, а не новий тест поверх порожнього місця.
