# Customer Source Test Traceability

> Стан звірки: 2026-04-27.
> Мета: показати, що саме з трьох клієнтських source-файлів уже має automated proof у проекті, а що не можна чесно назвати на 100% готовим без окремої реалізації або інтеграції.

## 1. Перевірені source-файли

Канонічними для цієї звірки є тільки ці файли з `docs/`:

| Source | Прочитано | Що містить |
|--------|-----------|------------|
| `Allgemeine Anamnese (in Bearbeitung).pdf` | 1 PDF page, extracted text checked fully | первинний anamnesis flow: головна причина звернення, актуальний анамнез, case ID, fallback option, направник, попередні хвороби, операції, алергії, щеплення, медикаменти, vegetative anamnesis, симптоми, pain, specialist selection, cardiology |
| `Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf` | 1 PDF page, extracted text checked fully | lead/customer journey: lead qualification, compliance, contracts, conversion, PM assignment, planning, billing release, appointments, interpreter/concierge execution, document forwarding/translation, follow-up |
| `1 (Update 2) User Story Salesforce.xlsx` | all visible sheets checked | `User Stories` rows 2-184, `RBAC Matrix`, `KPIs` |

Existing normalized Ukrainian derivatives remain useful references:

- `docs/requirements/01_process-mapping_ua.md`
- `docs/requirements/02_anamnese-flow_ua.md`
- `docs/requirements/03_product-backlog_ua.md`
- `docs/backlog/02_rbac-matrix_ua.md`
- `docs/testing/backlog-proof-matrix_ua.md`

## 2. Scope Decision

Станом на 2026-04-27 зовнішні інтеграції не входять у current release scope. Тому такі вимоги не блокують внутрішню готовність даних:

- `QES/eIDAS` provider integration
- `DATEV` export integration
- `E-Rechnung` production/legal format integration
- real payment provider checkout / settlement
- AI handoff / AI evaluation integration

Внутрішній scope, який треба вважати обов'язковим: lead/customer process, patient registry, anamnesis/cases, appointments, interpreter/concierge workflows, providers, documents, portal, secure communication, billing core, accounting ledger, RBAC, compliance, SOPs, feedback, reports/KPIs.

## 3. Automated Test Corpus

Current project proof surface:

| Suite | Command | Proof size |
|-------|---------|------------|
| Frontend unit/component/helper | `npm run test` | 245 tests in 22 files on latest full run |
| Browser E2E mock/API-backed | `npx playwright test --list` | 43 tests in 8 files |
| Browser live E2E DB-backed | `npx playwright test -c playwright.live.config.ts --list` | 84 tests in 18 files |
| Rust unit/integration/API/scheduler/RBAC | `cargo test --workspace --locked -- --list` | 495 tests |

Latest verification for the internal data scope was green:

- `npm run test`
- `npm run lint`
- `npm run build`
- `npm run test:e2e`
- `npm run test:e2e:live`
- `cargo fmt --all -- --check`
- Rust domain/API/server targets were run in bounded batches and covered all non-empty Rust test targets (`495/495` tests). The monolithic `cargo test --workspace --locked` command hit the local command timeout, not an assertion failure.

No production runtime code was changed by this source audit.

## 4. Coverage Matrix

| Source area | Customer expectation | Main automated proof | Status |
|-------------|----------------------|----------------------|--------|
| Lead intake and customer conversion | lead capture, need capture, compliance/data gates, contract/order/quote, conversion to customer, PM assignment, failed-lead deletion/anonymization | `leads_api.rs`, `process_gates_api.rs`, `workflow_checklists_api.rs`, `contracts_quotes_api.rs`, `leads.live.spec.ts`, `commercial.live.spec.ts` | Confirmed |
| Existing customer re-check | master data, compliance docs, contract validity, identity, debt hold before new package/order | `process_gates_api.rs`, `patients.live.spec.ts`, `commercial.live.spec.ts` | Confirmed |
| Patient registry | create/manage patients, demographics, contacts, insurance/emergency data, relations, assignments, timeline | `workspace_filters_api.rs`, `patient_clinical_api.rs`, `patients.live.spec.ts`, `patient-portal.live.spec.ts` | Confirmed |
| Medical anamnesis case | case ID generation, overview, Hauptanfragegrund, aktuelle Anamnese, Zuweiser, repeatable blocks, history | `case_anamnesis_api.rs`, `workspace_filters_api.rs`, `cases.live.spec.ts`, `patients.live.spec.ts` | Confirmed |
| Anamnesis clinical blocks | Vorerkrankungen, Operationen, Allergien, Impfstatus, Medikamente, vegetative anamnesis, pain, symptoms | `case_anamnesis_api.rs`, `workspace_filters_api.rs`, case workspace unit/UI code | Confirmed |
| Specialty subflows | cardiology from PDF plus extended specialty library | `case_anamnesis_api.rs`, `workspace_filters_api.rs`, `cases.live.spec.ts` | Confirmed for implemented library |
| Providers and partner clinics | clinic/doctor/service registry, filters, provider detail, templates, linked patients/interactions | `provider_catalog_api.rs`, `provider_templates_api.rs`, `providers.live.spec.ts`, `staff-workflows.live.spec.ts` | Confirmed |
| Assignments and role visibility | patient manager, interpreter, teamlead, concierge, billing, sales, CEO/assistant visibility boundaries | domain RBAC tests, `workspace_filters_api.rs`, `rbac-denied-routes.live.spec.ts`, `staff-route-access.test.ts` | Confirmed with hardening backlog |
| Appointments | medical/non-medical appointments, conflicts, recurrence, reminders, checklists, reports, interpreter assignment, mobile interpreter view | `appointment_care_path_api.rs`, `appointments_portal_api.rs`, `appointments-staff.live.spec.ts`, `appointments-recurring.live.spec.ts` | Confirmed |
| Interpreter operations | briefing, assignment response, report, hours, PM approval, auto-billed interpreter line | `appointment_care_path_api.rs`, `appointments-staff.live.spec.ts`, `chat-secure.live.spec.ts` | Confirmed |
| Concierge operations | non-medical service requests, execution, ready-for-billing, patient portal requests/cancel | `appointment_care_path_api.rs`, `me_api.rs`, `patient-portal.live.spec.ts` | Confirmed |
| Treatment plan and preparation documents | generated PDFs, provider prep templates, auto-send once, patient confirmation | `documents_api.rs`, `provider_templates_api.rs`, `patient-portal.live.spec.ts`, `staff-workflows.live.spec.ts` | Confirmed |
| Document management | upload/import, classify, view/download, template generation, release/revoke, provider share/revoke, translation workspace, missing document alerts | `documents_api.rs`, `me_api.rs`, `staff-workflows.live.spec.ts`, `patient-portal.live.spec.ts` | Confirmed |
| Secure communication | patient secure messages, staff/internal messages, attachments, allowed peers, unread handling | `messages_api.rs`, `messages_portal_api.rs`, `chat-secure.live.spec.ts` | Confirmed |
| Billing/order finance | quotes, invoices, dunning, payment states, billing release, package coverage, cost passthrough, external invoice registry, internal accounting ledger | `contracts_quotes_api.rs`, `invoices_api.rs`, `external_invoices_api.rs`, `commercial.live.spec.ts` | Confirmed inside internal scope |
| Patient portal | released docs, own uploads, appointments, service requests, invoices, payment proof upload, feedback, privacy export/request | `me_api.rs`, `appointments_portal_api.rs`, `patient-portal.live.spec.ts` | Confirmed inside internal scope |
| Feedback and risk | feedback intake/review, role-scoped feedback rows, risk/forecasting/report workspaces | `feedback_api.rs`, `stats_api.rs`, `feedback.live.spec.ts`, `analytics.live.spec.ts` | Confirmed |
| KPI catalog | CEO, PM, interpreter, concierge, billing, sales scorecards and reports | `stats_api.rs`, `analytics.live.spec.ts`, `commercial.live.spec.ts` | Confirmed at product/report level |
| SOP/learning | SOP creation, approval, publication, acknowledgement | `sops_api.rs`, `sops.live.spec.ts` | Confirmed |
| Security/compliance/audit | sessions, MFA, audit analytics, privacy requests, consent, erasure/restriction | `auth_sessions_api.rs`, `admin_mfa_api.rs`, `admin_compliance_api.rs`, `admin_security_api.rs`, live auth/compliance specs | Confirmed |

## 5. 2026-04-27 Data Verification Notes

Two proof-layer issues were found and closed during the internal data verification:

| Area | Issue | Fix |
|------|-------|-----|
| Anamnesis symptoms | backend route and UI already supported `symptome`, but there was no dedicated backend round-trip proof for `Beschreibung + Fachrichtung` | added `save_symptome_round_trips_description_and_fachrichtung` in `crates/server/tests/case_anamnesis_api.rs` |
| Mock browser E2E appointment data | `staff-smoke.spec.ts` used hard-coded `2026-04-20`, so after the calendar moved to the week of 2026-04-27 the event was valid mock data but not visible in the current-week calendar | changed the mock appointment date to the current local test date |

Verification passed after these fixes:

- `cargo fmt --all -- --check`
- `cargo test --locked --test case_anamnesis_api`
- Rust data/API/domain batches covering `495/495` non-empty tests
- `npm run test` (`245/245`)
- `npm run lint`
- `npm run build`
- `npm run test:e2e` (`43/43`)
- `npm run test:e2e:live` (`84/84`)

## 6. Out-of-Scope From Customer Source

These are real source requirements, but current code/test evidence does not prove them as finished production flows:

| Requirement | Source location | Current evidence | Status |
|-------------|-----------------|------------------|--------|
| QES/eIDAS electronic signature | Excel EPIC 6 and EPIC 19 rows around signature/order signing | framework contract/sign status exists, but no compliant QES/eIDAS provider flow or end-to-end signature provider proof | Out of current scope |
| DATEV export | Excel EPIC 9, row 77 | internal accounting ledger/export exists; DATEV-specific export is not required for current release | Out of current scope |
| E-Rechnung | Excel EPIC 9, row 85 | invoice PDFs/state flows exist; production E-Rechnung format is not required for current release | Out of current scope |
| Real payment checkout/settlement | Excel portal/payment expectations | patient can upload payment proof; payment provider checkout/settlement is not required for current release | Out of current scope |
| AI transfer/evaluation | Excel EPIC 24 rows 182-184 | privacy/anonymization pieces exist for lead/compliance flows; AI handoff/evaluation is not required for current release | Out of current scope |
| Every KPI row one-to-one | Excel `KPIs` sheet, 92 rows | role scorecards and major report groups are covered; not every single KPI row has a dedicated assertion | Optional proof hardening |
| Every RBAC cell one-to-one | Excel `RBAC Matrix` | high-risk backend and browser route/cell coverage exists; exhaustive matrix density remains a hardening track | Optional proof hardening |

## 7. Practical Conclusion

For the internal MVP CRM/operations scope, the project has strong automated coverage across patient registry, appointments, anamnesis, providers, documents, secure chat, billing, portal, RBAC, compliance, SOPs and analytics.

With integrations explicitly out of scope, the internal customer-data scope is verified by automated tests.

Recommended next delivery order:

1. Keep external integrations frozen as out-of-scope for this release.
2. Treat new work as proof hardening only: more exhaustive RBAC cells and one-to-one KPI assertions where the customer asks for a precise KPI-by-KPI acceptance matrix.
3. Do not reopen production feature scope unless a customer source requirement is reclassified from integration/out-of-scope to current release.
