# Full Docs / Backlog Reconciliation (UA)

> Повна звірка документації в `docs/` з поточним станом репозиторію станом на **2026-04-15**. Це не заміняє канонічні вимоги; файл потрібен, щоб розвести: `source-of-truth`, planning docs, current-state код і явні gaps.

## 1. Методика звірки

Перевірені шари:

- `docs/00_source-of-truth_ua.md`
- `docs/requirements/*`
- `docs/backlog/*`
- `docs/architecture/*`
- `docs/development-plan.md`
- `docs/testing/*`
- route layer, frontend pages, міграції, integration tests і regression matrices

Статуси в цьому файлі:

- `Confirmed` — підтверджено кодом і/або regression tests
- `Partial` — є суттєва частина, але не повний scope документа
- `Gap` — вимога/беклог є, реалізація не підтверджена
- `Planning/Stale` — документ корисний як план або target-state, але не є актуальним status-документом

## 2. Source-of-truth layer

### 2.1 Оригінали

- `docs/1 (Update 2) User Story Salesforce.xlsx` — **є**
- `docs/Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf` — **є**
- `docs/Allgemeine Anamnese (in Bearbeitung).pdf` — **є**

### 2.2 Трасованість

- `docs/testing/user-stories-excel-backlog-audit_ua.md` підтверджує **1:1** відповідність між Excel `User Stories` і `docs/requirements/03_product-backlog_ua.md`
- `docs/requirements/01_process-mapping_ua.md` і `docs/requirements/02_anamnese-flow_ua.md` лишаються канонічними текстовими нормалізаціями PDF

Висновок:

- source layer **узгоджений**
- проблема не в трасованості документів, а в тому, що planning docs і код живуть швидше, ніж чекбокси у backlog

## 3. Статус по документах

### 3.1 `docs/requirements/01_process-mapping_ua.md`

Статус: `Confirmed + Partial`

Підтверджено current-state:

- lead qualification / conversion gates
- existing-customer `re-check`
- order lifecycle `discovery -> intake -> execution -> closure -> follow-up`
- planning / preparation / execution / follow-up readiness
- appointments, interpreter / concierge handoff, checklists, timeline
- approved interpreter reports now auto-create agency-priced `order_leistungen` through `agency_service_catalog` (`interpreter_hours`), and scheduler backfill closes historic `missing_catalog` cases without duplicates; live browser proof now also covers the staff path `assign -> submit -> approve -> auto-billed line visible in order detail`
- completed medical appointments now auto-create the time-bound `Organisation der Behandlung` billing line through `agency_service_catalog` (`treatment_organization`), keep provenance via `source_medical_appointment_id`, and dedupe repeated completion; live browser proof covers `complete appointment -> order detail shows the auto-billed line`
- billing release / package coverage / debt hold / failed-lead resolution

Незакрито відносно process map:

- зовнішній `DATEV` / accounting handoff
- real payment-provider checkout / settlement
- повний `E-Rechnung`
- eSign / `eIDAS / QES`

### 3.2 `docs/requirements/02_anamnese-flow_ua.md`

Статус: `Confirmed + Partial`

Підтверджено current-state:

- structured case intake
- repeatable sections: preconditions, allergies, operations, medications, symptoms, pain, vegetative, vaccination
- doctor FK links for `Zuweiser`, `Arzt`, `Verordnender Arzt`
- dedicated `Cardiology`, `Gastroenterology`, `Orthopedics`, `Neurology`, `Pulmonology` and `Urology` sub-flows
- patient-level `clinical_warnings` and time-series vital measurements with `measured_at`, blood pressure, heart rate, weight, height and BMI
- patient-level `Karteikartenzeilen` / `patient_card_entries` stream with category, source, author and timeline integration
- patient-level `medical_orders / therapy_orders` slice with structured order type, instructions, due date and status lifecycle
- patient-level `risk_scores` slice with structured score type, numeric value, optional scale, interpretation and JSON inputs
- dedicated `case_text_snippets` library for anamnesis authoring with reusable placeholder-aware text blocks and direct insertion into `aktuelle_anamnese`
- medication expiry review loop with `expiry_date`, scheduler-created confirmation events and explicit PM/CEO confirmation flow for expired permanent medication
- section history via `case_versions`
- explicit `case_uuid`, retention metadata and append-only clinical history

Ключові рішення після звірки:

- `cases.id` / `case_uuid` тепер трактуються як системний UUID
- `case_id` лишається human-readable reference code

Незакрито:

- подальші specialty branches тепер є вже розширенням specialty library, а не незакритим базовим pattern gap
- appointment cycle already має explicit `care_path_kind` semantics (`regular / preventive / control / followup`) для staff appointments, patient portal request flow і convert-time propagation; окремий preventive-only program model лишається лише optional extension, не gap

### 3.3 `docs/requirements/03_product-backlog_ua.md`

Статус: `Confirmed as scope catalog`, не як live status

- файл коректний як канонічний каталог scope
- не можна читати його як список “що вже зроблено”
- live status треба брати з `docs/testing/*`

### 3.4 `docs/requirements/04_non-functional-requirements_ua.md`

Статус: `Partial`

Підтверджено:

- RBAC + assignment-based access
- auth/session revocation semantics for `logout` and `logout-all`
- audit logging
- consent/privacy workflows
- encryption / key-management layer для direct messages
- immutable clinical/document/compliance history в ключових slices

Незакрито або не підтверджено повністю:

- `eIDAS / QES`
- payment-provider integration
- `DATEV`
- AI pseudonymization handoff
- production-grade infra items типу backup/DR не видно з самого коду repo

## 4. Статус по backlog-документах

### 4.1 `docs/backlog/01_mvp-backlog_ua.md`

Статус: `Mostly aligned as release decomposition`

#### Foundation

- `Confirmed/Partial`
- auth, roles, assignments, audit, compliance, settings, core reference data є
- інфраструктурні речі типу backup/recovery і TLS не верифікуються з repo напряму

#### Intake & Case

- `Confirmed`
- patient registry, anamnesis, leads, orders, provider registry реально покриті

#### Delivery Operations

- `Confirmed`
- appointments, providers, interpreter/concierge operations, documents, sharing, workflow gates є

#### Finance & Portal

- `Partial`
- quotes, invoices, Mahnwesen, patient invoices/documents/privacy/services, portal appointments є
- finance-facing analytics already include provider/service price and cost movement reporting for internal pricing comparison
- real payment checkout відсутній
- e-signature відсутня

#### Analytics / SOP / AI

- `Partial`
- KPI, reports, risk-analysis, forecasting, SOP/library є
- AI readiness / pseudonymization / AI integration — gap

### 4.2 `docs/backlog/02_rbac-matrix_ua.md`

Статус: `Mostly to strongly confirmed`

Підтверджено:

- усі 10 ролей існують у домені
- patient-manager visibility scoped by assignments
- interpreter / concierge / billing segregation реально є
- patient portal працює через explicit release/freigabe
- documents / medical sharing мають окремі policy layers

Додатково вже regression-підтверджено:

- `CEO Assistant` read-only patient registry scope з field-level masking
- `CEO Assistant` read-only document-template catalog access without generation rights
- `CEO Assistant` read-only document share/translation trail access on released documents, while provider-share and translation mutations remain blocked
- documents workspace/nav тепер більше не світиться і не відкривається для `sales` та `it_admin`, включно з list/detail/meta/template read paths
- `CEO` full commercial access plus `CEO Assistant` read-only access for contracts/quotes workspace, while `sales` and `concierge` stay denied from patient-bound commercial routes
- `CEO Assistant` read-only invoice/PDF/dunning access, while `CEO` and `billing` retain finance mutation rights and `sales` / `concierge` stay denied from invoice workspace surfaces
- patient profile shell більше не обходить ці RBAC межі через UI: restricted operational/document/commercial tabs не рендеряться, `documents` quick-link лишається тільки для document-workspace roles, а timeline не deep-links у `documents / contracts / invoices`, якщо ця surface для ролі закрита
- browser smoke тепер окремо цементує цей patient-profile shell для `CEO Assistant`: заборонений `?tab=documents` redirect-иться назад у `profile`, operational tabs не з’являються, а read-only `Contracts` / `Invoices` surfaces залишаються доступними
- lead conversion gating теж уже зацементований на browser-рівні: `patient_manager` бачить disabled `Convert` на `qualified` lead, якщо backend list payload віддає `conversion_ready=false`, і enabled state для ready lead без зайвого 422 round-trip
- `sales` deny на patient registry, executive dashboard, risk-analysis і restricted clinic/doctor exports
- `CEO Assistant` access до reports / forecasting / risk workspaces як partial executive read model
- `teamlead_interpreter` assignment-scoped patient/appointment visibility
- broad analytics deny для `teamlead_interpreter`, `interpreter` і `concierge`
- `it_admin` deny на patient registry, medical case detail і reports workspace
- `billing` deny на medical case detail
- `patient_manager` document share routes remain assignment-scoped even on direct endpoint access
- internal chat workspace тепер теж role-aligned: `sales` повністю відрізаний від agency chat, а operational staff allowed-peer lists не світять sales-користувачів як внутрішніх chat targets
- appointments workspace/nav тепер більше не світиться і не відкривається для `sales`, `billing`, `ceo_assistant` та `it_admin`, тобто поза реальним operational appointment chain
- feedback workspace/nav тепер більше не світиться і не відкривається для `billing`, `sales`, `interpreter` та `it_admin`, тобто staff feedback surfaces лишаються тільки для реальних review/capture roles

Частково / потребує подальшої перевірки:

- не кожен можливий осередок матриці підтверджений окремим integration/regression test

Висновок:

- матриця коректна як policy target
- current-state загалом їй відповідає; незакритим лишається радше exhaustiveness regression coverage, а не відсутність ключових access boundaries

### 4.3 `docs/backlog/03_kpi-catalog_ua.md`

Статус: `Mostly confirmed`

Підтверджено:

- CEO dashboard
- PM / billing / interpreter / concierge KPIs
- role-scoped operational `my KPI` dashboard scorecards for `patient_manager`, `teamlead/interpreter` and `concierge`
- clinic / doctor / country / service-type reports
- sales-safe medical provider performance and revenue reports
- explicit billing KPI scorecard in reports workspace: invoices, service-to-invoice timing, on-time-14-day rate, receivables, dunning, self-pay share and cost-passthrough share
- explicit sales KPI scorecard in reports workspace: new/qualified/converted leads, lead-to-patient conversion, lead-country spread and new partner clinics per quarter
- medical provider cost-intelligence reports with historical unit-price movement and CSV export
- provider-quality signals in reports: treatment score, doctor communication, follow-up completion, organization/service/ambience/value scores, treatment-success and complication rates, written-findings turnaround, clinic/doctor response-time KPIs from appointment communications
- NPS / feedback surfaces
- risk-analysis
- forecasting workspace

Частково:

- не всі KPI із каталогу мають окремий explicit regression test або окремий dedicated dashboard tile, але billing/sales scorecards тепер закриті окремим analytics regression
- predictive / AI-style analytics лишаються gap

### 4.4 `docs/backlog/04_implementation-tasks_ua.md`

Статус: `Planning/Stale`

Файл корисний як phase/task decomposition, але **не відображає реальний статус**. Чекбокси залишаються unchecked навіть для вже реалізованих slices.

#### Phase 1

- `Mostly confirmed`
- patient registry, anamnesis, providers, orders, appointments, documents, billing basics, assignments, workflows, templates, communication, CEO module, process engine значною мірою закриті

Головні gaps Phase 1:

- `T-003` / `T-004` / `T-009` інфраструктурного класу не верифікуються з repo
- `T-066 DATEV`
- частина advanced accounting / compliance operationalization
- `T-100 AI preparation`

#### Phase 2

- `Partial to Mostly confirmed`
- reminders, reports, KPI, risk analysis, SOP, conflict handling, partner/provider reporting значною мірою є

Головні gaps Phase 2:

- `E-Rechnung`
- частина advanced accounting features

#### Phase 3

- `Mostly confirmed`
- interpreter / concierge flows, feedback, calendar extensions, teamlead SOP path, role KPIs largely є

Частково:

- повний end-to-end interpreter communication package still depends on broader messaging layer maturity

#### Phase 4

- `Partial`
- patient portal, appointment requests, invoice visibility, uploads, privacy, services, feedback є
- secure messaging already має text + attachment `E2E` і manual secure key backup / import для переносу між девайсами

Незакрито:

- `T-162` real invoice payment
- `T-164..166` e-signature
- `T-172..174` AI

## 5. Статус по architecture docs

### 5.1 `docs/architecture/01_target-architecture_ua.md`

Статус: `Mostly aligned as target-state`

Підтверджено:

- modular monolith
- main bounded modules in route/service layer
- PostgreSQL as transactional store
- object/document storage model
- reporting / KPI read-model style slices

Target-state, але не повністю підтверджено:

- external payment provider
- accounting / DATEV export
- AI gateway
- full queue/search decomposition as explicit infra modules

### 5.2 `docs/architecture/02_field-level-access-control.md`

Статус: `Mostly aligned as design pattern`

Підтверджено:

- system rules + role/context access model
- field access policies / overrides concept
- document release / share-status based filtering

Потрібно не плутати:

- це design doc, а не exhaustive test matrix
- для фактичної перевірки треба дивитись `access`, `patients`, `documents`, `messages` і regression suites

## 6. `docs/development-plan.md`

Статус: `Planning/Stale`

Ключові розходження з repo:

- документ планує `Leptos`, а реальний frontend зараз `React/Vite`
- документ планує `AWS Cognito або самостійний JWT`; у repo current-state — власний auth/JWT stack
- документ описує цільовий delivery timeline, а не фактичний live status

Висновок:

- використовувати тільки як historical delivery baseline
- не використовувати для відповіді на питання “що вже зроблено”

## 7. Current-state reconciliation по функціональних доменах

| Домен | Статус | Примітка |
|------|--------|----------|
| Identity / RBAC / Audit | Mostly confirmed | ролі, assignments, MFA/admin, audit, compliance routes є |
| Patient Registry | Confirmed | profile, tabs, timeline, relations, labels, consents, privacy, live browser proof for label/timeline/re-check surfaces |
| Medical Case / Anamnesis | Mostly confirmed | structured sections, FK doctors, 6 specialty sub-flows, anamnesis text snippets, history, retention |
| Providers / Clinics / Doctors | Mostly confirmed | registry, doctors, enrichments, linked-patient/interactions detail, provider-specific templates, clinic/doctor reports |
| Leads / CRM | Mostly confirmed | qualification, conversion, failed-flow, readiness gates |
| Orders / Process Engine | Mostly confirmed | lifecycle, billing/package/debt gates, planning/execution/follow-up |
| Appointments / Calendar | Confirmed | medical + non-medical, conflicts, recurrence, true split lineage, scope-aware bulk actions, portal requests and DB-level overlap constraints |
| Documents / Sharing | Confirmed | upload, release, OCR/translation workspace, policy checks |
| Billing / Finance | Partial | quotes, invoices, dunning, VAT, portal invoices, external inbound invoice tracking with overdue alerts, internal cash-based `accounting_entries` ledger / EÜR export, provider cost-intelligence reports and sales-safe medical-provider revenue reports є; DATEV/E-Rechnung/payments gap |
| Commercial catalog | Confirmed | agency-level pricing catalog now exists separately from provider `service_catalog`, with role-scoped read/manage access in the contracts workspace |
| Portal | Confirmed | documents, invoices, privacy, services, appointments, feedback, chat, required-document alerts and live self-service browser proof |
| Messaging | Confirmed | text + attachment E2E, allowed-peer scope, portal/staff chat flows і audit/regression coverage зібрані |
| Feedback / NPS | Confirmed | portal submission + staff review + ranking |
| SOP / Learning | Confirmed | library, approval flow, acknowledgement |
| Reports / KPI / Forecasting / Risk | Mostly confirmed | CEO dashboard, reports, billing/sales KPI scorecards, risk-analysis, forecasting |
| AI / pseudonymization | Gap | privacy anonymization є, AI handoff workflow окремо не реалізований |
| eSignature | Gap | немає current-state `eIDAS/QES` flow |

## 8. Реальні незакриті моменти без зовнішніх інтеграцій

Цей блок спеціально **не включає** `DATEV`, payment-provider checkout, `E-Rechnung`, `eIDAS/QES` та інші зовнішні інтеграції.

### 8.1 Still real in-scope gaps

- Якщо `AI` лишається в scope, `AI / pseudonymization -> AI handoff` усе ще лишається окремим незакритим workflow: privacy/anonymization mechanics уже є, але bounded pipeline для AI-ready export, role-scoped access і audit trail поверх них не реалізований.
- Якщо `AI` свідомо виключений з поточного scope, цей блок більше не містить активних внутрішніх `product gaps`; далі лишаються лише optional extensions і hardening.
- У clinical domain ще може знадобитися richer preventive/control program model поверх current `care_path_kind`, якщо source scope вимагатиме окрему preventive orchestration semantics. На поточному current-state це вже не blocker, а potential domain extension.

### 8.2 Partial / optional tails

- `RBAC` матриця загалом збігається з кодом; high-risk boundaries вже покриті regression tests, а незакритим лишається тільки поступове добивання exhaustive matrix coverage.
- KPI / reports / forecasting уже покривають current-state executive, provider, billing і sales layers; подальша робота тут — це catalog expansion і stronger regression granularity, а не missing базовий analytics slice.
- Current-state freeze verification уже зелений: `cargo test --workspace`, `frontend npm test`, `frontend npm run lint`, `frontend npm run build`, `frontend npm run test:e2e` (`22/22`) і `frontend npm run test:e2e:live` (`47/47`) пройшли на цьому зрізі коду. Подальша робота тут — це тільки ущільнення regression inventory, а не закриття “непідтвердженого” продукту.
- `docs/backlog/04_implementation-tasks_ua.md` і `docs/development-plan.md` треба читати як planning-only; після останніх runtime хвиль вони більше не є live-status документами.
- Найбільший поточний engineering risk не в product coverage, а у mixed worktree / commit hygiene: verified freeze already green, але дерево все ще треба тримати розкладеним по bounded commits / PR slices.

### 8.3 Not real gaps anymore

- patient-level clinical enrichment (`vitals`, `clinical_warnings`, `card log`, `medical orders`, `risk scores`)
- `assign_patient` / `revoke_assignment` notifications
- provider `rating_gte` filter
- medication auto-expire confirmation loop
- provider-specific templates і partner preparation auto-send
- external inbound invoice tracking
- internal cash-based `accounting_entries` ledger / EÜR export
- `agency_service_catalog`
- patient service report
- anamnesis `case_text_snippets`
- audit analytics dashboard

## 9. Документи, що зараз найбільш корисні як live status

Для реального стану системи варто читати в такому порядку:

1. `docs/testing/full-docs-backlog-reconciliation_ua.md`
2. `docs/testing/current-state-gap-audit_ua.md`
3. `docs/testing/source-workspace-regression-matrix.md`
4. `docs/testing/source-documents-regression-matrix.md`
5. `docs/testing/source-billing-regression-matrix.md`
6. `docs/testing/worktree-stabilization-inventory_ua.md`

## 10. Підсумок

### Що вже узгоджено добре

- source docs і їх трасованість
- requirements layer як канонічний scope
- більша частина core product slices: patient, case, provider, order, appointment, documents, billing basics, portal, SOP, reports

### Що треба вважати planning-only

- `docs/backlog/04_implementation-tasks_ua.md`
- `docs/development-plan.md`

### Найбільші реальні gaps після повної звірки

- `AI / pseudonymization -> AI handoff`
- optional domain extension around richer preventive/control program semantics, if source scope ever needs more than the current `care_path_kind` layer on generic appointment rows
- stabilization / inventory і подальше ущільнення regression coverage
- базовий browser-level `E2E` harness уже є і не обмежується навігацією: Playwright покриває staff shell (`dashboard -> patients -> appointments -> documents -> invoices`), staff document portal release/revoke flow, staff template-based document generation flow, provider share/revoke з cover message, staff file-delete lifecycle, staff translation-workspace request/save/complete flow, staff feedback review flow, case text snippet create/preview/insert/save flow всередині анамнезу, interpreter report `assign -> submit -> approve -> auto-billed order line` flow, patient portal (`dashboard -> documents -> invoices -> appointments -> services -> feedback -> chat`), patient dashboard required-document alerts, patient invoice payment-proof upload, patient data export + privacy request submission, portal document receipt confirmation, provider-template auto-send receipt confirmation, portal self-upload + re-download loop, portal appointment-request submit, portal concierge-service request/cancel, portal appointment-linked feedback submit, patient-profile timeline/document filtering plus authenticated patient-sticker fetch, patient-profile relations/workflow completion, create-order existing-customer re-check blockers, recurring appointment whole-series cancellation і whole-series recurrence-rule reshape з detail drawer, staff secure chat text-send + secure attachment-send flows і окремий patient-portal secure chat flow з encrypted text + attachment, unread-state clearing і allowed-peer picker filtering через browser keyring/mock envelope path; окремо backend regression уже цементує `logout` / `logout-all` session revocation semantics, `portal feedback -> staff review -> patient history`, `portal feedback notifications -> assigned roles only`, `portal service request -> assigned staff notifications/queue only + portal status reflection` і same-series recurring reshape без false self-conflict. На цьому зрізі весь consolidated freeze pass зелений, включно з live DB-backed Playwright suite, тому незакритим лишається вже не наявність browser/session coverage, а тільки подальше optional-ущільнення mutation-сценаріїв.
- `Documents / Sharing` уже підтверджені end-to-end: upload/release, OCR/translation workspace, policy checks, file delete lifecycle, provider cover-message trail і patient-requested third-party revoke workflow тепер автоматизовані regression tests

### Окремо: інтеграційні gaps

- `DATEV`
- `E-Rechnung`
- real payment checkout / settlement
- `eIDAS / QES`

### Найбільший технічний ризик не в docs, а в worktree

- документація вже достатньо розкладена, щоб бачити картину
- основний engineering risk зараз — великий незведений worktree, а не відсутність розуміння scope або verification coverage

## 11. Практичний Execution Order Без Інтеграцій

Нижче не “весь беклог”, а короткий порядок робіт по **реальних внутрішніх gaps**, які ще лишилися після звірки.

### P0. Stabilization / inventory

1. Розвести поточний великий worktree по bounded commits / slices.
2. Зафіксувати окремо, що вже current-state, а що ще WIP.
3. Не брати нові широкі фічі, поки дерево не стане прозорим для clean commit/PR slicing після вже зеленого regression freeze pass.

Причина:

- зараз найбільший engineering risk саме в змішаному worktree, а не в нестачі scope-розуміння або у відсутності regression verification

### P1. Regression hardening

1. Добити regression coverage для решти клітинок `docs/backlog/02_rbac-matrix_ua.md`, які ще не мають explicit tests.
2. Зафіксувати granular KPI assertions там, де read-model already є, але ще не весь catalog перевіряється окремими tests.
3. Не змішувати це з новими великими feature slices.

Що має вийти:

- не нові фічі, а прозорий current-state з щільнішим regression-proof

### P2. Optional scope extensions

1. Нові specialty branches робити тільки якщо вони реально потрібні бізнесу, а не як “добити список заради списку”.
2. KPI catalog розширювати тільки там, де є конкретний decision use-case, а не як абстрактний dashboard growth.
3. Не розширювати scope, поки не завершено stabilization.

Що має вийти:

- тільки осмислені extension slices після стабілізації, без штучного “добивання” вже закритого базового scope

### P3. AI / pseudonymization handoff

1. Не починати з “AI features”.
2. Спочатку визначити bounded workflow: які дані готуються, де псевдонімізуються, хто має доступ, який audit trail потрібен.
3. Тільки після цього додавати AI-ready pipeline поверх already existing privacy/anonymization mechanics.

## 12. Що Робити Прямо Зараз

Якщо рухатись прагматично, правильний порядок такий:

1. `Stabilization / inventory`
2. `Regression hardening`
3. optional targeted extensions only if they have real business pressure
4. `AI / pseudonymization handoff` only if AI is re-included into scope
