# Current-State Gap Audit (UA)

> Робочий аудит стану коду станом на **2026-04-13**. Цей файл не змінює канонічні вимоги з `docs/requirements/*`; він фіксує, що вже є в репозиторії, а що ще лишається gap між PDF/Excel scope і реалізацією.

## 1. Що підтверджено як факт

- Excel-файл `1 (Update 2) User Story Salesforce.xlsx` **є** в репозиторії: `docs/1 (Update 2) User Story Salesforce.xlsx`.
- `docs/requirements/01_process-mapping_ua.md` і `docs/requirements/02_anamnese-flow_ua.md` оформлені як канонічні текстові нормалізації відповідних PDF; при розбіжності пріоритет має PDF.
- `docs/testing/user-stories-excel-backlog-audit_ua.md` підтверджує **1:1** трасованість аркуша `User Stories` до `docs/requirements/03_product-backlog_ua.md` по всіх EPIC.
- У billing slice вже є не тільки handoff, а й `quotes`, `invoices` і `Mahnwesen`.
- Портал пацієнта вже існує як окремий current-state slice: документи, privacy requests, invoices, appointment requests, services.
- У clinical case slice вже є section-level version log через `case_versions`; тому versioning не відсутній повністю.
- Identity/session security already має explicit regression coverage: `logout` і `logout-all` одразу denylist-ять поточний access token, revoke-ять refresh-family і гасять інші відкриті сесії того ж користувача без очікування access-token expiry.

## 2. Що виявилось неточним у попередніх зведеннях

- Неправильно писати, що Excel-файл відсутній у `docs/`.
- Неправильно писати, що `Mahnwesen` або `invoices` ще не реалізовані як backend module.
- Неправильно описувати patient portal як повністю відсутній.
- Неправильно описувати versioning анамнезу як повністю відсутній; коректніше казати, що потрібно ще оцінити повноту retention / immutability / audit semantics.

## 3. Підтверджені current-state gaps

### 3.1 Process map / lead gates

- У `leads` і `orders` уже є bounded lifecycle engine: sequential transitions, history events і blockers для `qualification/conversion`, existing-customer `re-check`, `execution`, `closure`, `follow-up`, але це ще не весь process-map scope по всіх суміжних фінансових та операційних вузлах.
- `Schuldenmanagement` тепер оформлений як окремий order-level workflow з queue, owner/review timestamps, `payment_plan / awaiting_payment / escalated / cleared` статусами, блокуванням execution і відображенням у patient re-check; незакритими лишаються зовнішні payment-provider / accounting handoff сценарії, а не базовий debt workflow.
- Гейт `Freigabe Abrechnung` і гілка `Paketleistung` тепер винесені в order process gates, але не покривають увесь фінансовий сценарій кінця-в-кінець.
- Controlled failed-lead archive/delete flow тепер існує як окремий policy-driven workflow з reason/note, audit trail, lifecycle history і delete-as-anonymize semantics замість прямого hard delete.

### 3.2 Anamnese / clinical intake

- `Cardiology`, `Gastroenterology`, `Orthopedics`, `Neurology`, `Pulmonology` і `Urology` тепер виділені як окремі section-level sub-flows з structured assessment, recommendation trigger від symptoms і окремим version log; далі це вже розширення specialty library, а не незакритий базовий gap самого specialty-subflow pattern.

### 3.3 Billing / finance

- `DATEV` export не підтверджений як реалізований current-state module.
- `E-Rechnung` не підтверджена як реалізований current-state module.
- Немає real payment-provider checkout / settlement confirmation beyond payment-proof handoff.
- `Freigabe Abrechnung` тепер блокує `quote -> invoice` на backend-рівні, а `package coverage / debt hold` уже враховуються в order execution gates; незакритими лишаються зовнішні accounting/payment сценарії, а не сам базовий gate.

### 3.4 Security / analytics / learning / AI

- `eIDAS / QES` e-signature не підтверджена як готовий current-state flow.
- secure in-portal messaging тепер already має client-side `E2E` і для text messages, і для file attachments через per-user message keys та envelope storage на backend; ручний encrypted key backup / import закриває current-state device migration semantics без серверного доступу до private keys.
- CEO dashboard, окремий reports workspace, role-scoped risk-analysis і forecasting workspace уже покривають current-state метрики по виручці, дебіторці, країнах пацієнтів, клініках, service-type mix, sales-safe medical provider performance/revenue view, PM/interpreter/concierge load, clinic volume, NPS/feedback surfacing, doctor drill-down/export, provider-quality signals по treatment / doctor communication / follow-up completion, organization / service / ambience / value scores, treatment-success / complication rates, written-findings turnaround, response-time KPI signals із appointment communications, medical provider cost intelligence по historical unit-price movement, non-medical provider reporting/search по service portfolio і concierge load, quote pipeline, collections outlook, follow-up milestone pressure і clinic capacity next 30 days; незакритими лишаються predictive / AI-style forecasting і зовнішній accounting intelligence, а не сам базовий executive forecast layer.
- High-risk `RBAC` boundaries вже підтверджені regression tests не тільки для sales, а й для `CEO Assistant` patient read-only scope плюс reports/forecasting/risk access, `teamlead_interpreter` assignment visibility, operational-role deny на broad analytics workspaces, `it_admin` deny на patient/case/reports workspaces та `billing` deny на medical case detail; залишок тут — це вже exhaustive matrix hardening, а не відсутність базових policy boundaries.
- AI / pseudonymization flow не підтверджений як реалізований current-state slice.

## 4. Що вже ближче до реалізації

- Реєстр клінік і лікарів та зв'язка з пацієнтами через appointments/orders, включно з `legal_name / tax_id` на provider-рівні та `languages / licensing` на doctor-рівні.
- Patient profile з tabs, timeline, compliance trail, functional labels, consent register і privacy workflow.
- `CEO Assistant` тепер має окремо перевірений read-only доступ до patient registry list/detail через explicit patient field policies, без insurance/legal-status/internal-notes/functional-label exposure.
- Privacy-request schema тепер канонізується окремою follow-up migration: нормалізовані statuses/source/defaults, перестворені canonical indexes, а duplicate open requests одного типу для того ж пацієнта блокуються і в admin intake flow, і в patient self-service, і на DB-рівні через partial unique index.
- Consent register тепер моделює явний `expires_at`, вміє показувати прострочені згоди окремо і не рахує їх як active grants у compliance dashboard.
- Patient timeline тепер має backend pagination (`limit/offset`) і не вимагає завантаження всієї історії пацієнта одним запитом.
- Case intake sections `Overview`, `Operationen` і `Medikamente` тепер підтримують реальний doctor registry link через `provider_doctors` FK (`zuweiser_doctor_id`, `arzt_id`, `verordnender_arzt_id`) з legacy text fallback для історичних або ручних записів.
- Clinical cases тепер явно розводять системний UUID і human-readable reference code: `cases.id` / `case_uuid` є канонічним системним ідентифікатором, а `case_id` лишається операційним reference code формату `C-YYYYMMDD-####`.
- Clinical history більше не є лише прихованим snapshot log: `case_versions` тепер append-only на рівні БД, detail/history API віддає old/new values по секціях, а `cases` тримають `retention_until`, `last_clinical_update_at` і `version_count`.
- Case intake тепер має окремі `Cardiology`, `Gastroenterology`, `Orthopedics`, `Neurology`, `Pulmonology` і `Urology` sub-flows з structured clinical fields, symptom-triggered recommendation і section-level version logging.
- Browser-level regression harness already covers more than shell navigation: staff UI path for document portal release/revoke, provider share/revoke with cover message, template generation, file-delete lifecycle and translation workspace completion, recurring appointment whole-series cancellation from the detail drawer, secure chat text-send and secure attachment-send with local keyring/mock envelope path, plus patient portal invoice payment-proof upload, document receipt confirmation, self-upload + re-download and self-service export/privacy-request submission.
- Patient- і order-level workflow checklists з auto-seeded PM/concierge tasks, timeline sync і UI в profile/order workspace.
- Lead qualification/conversion readiness gates і order execution gates з debt hold, billing release та package coverage controls.
- Existing-customer `re-check` перед створенням нового order: backend readiness API перевіряє base data, compliance, identity, required documents, contract validity і overdue debt, а create-order UI показує blockers до submit.
- Order planning/preparation gate перед `intake -> execution`: treatment plan must be finalized, required medical and non-medical bookings confirmed, interpreter handoff and briefing closed when needed, and preparation documents marked as sent or explicitly not required.
- Order execution flow тепер має окремий readiness slice: arrival, delivered scope, interpreter-backed execution, incident resolution і execution checklist blockers перед `execution -> closure`.
- Order follow-up flow тепер має окремий readiness slice: doctor-directed outreach, milestones `1w / 1m / 6m`, package-end outreach, results handoff і patient-portal visibility по цих milestones перед `closure -> follow-up`.
- Lead failed-resolution workflow і order lifecycle transitions з history та blockers на `execution -> closure -> follow-up`.
- CEO dashboard / KPI slice поверх current-state transactional data: revenue and receivables, patient geography, patient-manager workload, interpreter and concierge productivity, clinic volume and feedback-based patient sentiment.
- Debt-management workflow поверх orders: queue, status machine, owner/review timestamps, order-level blockers і surfacing в existing-customer re-check.
- Dedicated reports workspace by clinics, doctors, countries, service types, sales-safe medical-provider performance/revenue view, medical-provider cost intelligence and non-medical providers with role-scoped financial visibility, clinic-to-doctor drill-down, provider-quality metrics, experience scores (`organization / service / ambience / value`), treatment-success / complication rates, written-findings turnaround, communication response-time KPIs, concierge partner load and CSV export for executive, patient-manager, billing and sales users.
- Dedicated forecasting workspace for executive / billing / PM / sales roles: quote pipeline weighting, collections outlook, follow-up milestone pressure and clinic capacity for the next 30 days.
- Role-scoped risk-analysis workspace: CEO/CEO Assistant бачать обидва шари, patient managers бачать автоматичні сигнали по своїх assigned patients/orders, а billing бачить фінансовий risk layer по overdue invoices, blocked billing/package gates і uninvoiced service exposure.
- Quotes, invoices, quote version snapshots, dunning, auto-dunning scheduler, VAT / passthrough logic, on-demand invoice PDF export and patient-facing invoice visibility.
- Appointment cycle з conflicts, preparation / execution / follow-up markers, portal appointment requests, creation-time recurring series, post-create recurrence-rule editing (`frequency / interval / count / until`), true split semantics for this-and-following reschedule/cancel, recurring bulk status controls for single occurrence / tail slice / whole active series, explicit split-lineage surfacing plus lineage-history analytics in the detail drawer, month/week grid quick actions, UI preflight warnings for bulk-complete checklist blockers і DB-level exclusion constraints поверх patient / interpreter / doctor overlap rules.
- Mobile-specific delivery for interpreter operations now has a dedicated compact appointment agenda on small screens, while `teamlead_interpreter` visibility over patients and appointments is explicitly regression-verified as assignment-scoped.
- Document release до patient portal, patient uploads, interpreter internal uploads з teamlead review/categorization queue, best-effort text extraction with `windows_ocr` / `tesseract_cli` fallback, portal privacy requests, concierge self-service requests, self-service `/me/export` as downloadable DSGVO ZIP bundle and patient-facing required-document alerts through `/me/document-alerts`.
- Provider-facing medical document sharing тепер додатково валідує specialty-match по appointment doctor context, щоб order-level involvement іншої клініки саме по собі не відкривало шлях для пересилки невідповідному медичному провайдеру.
- Для appointment-linked документів provider share policy тепер також віддає пріоритет самому appointment context над ширшим order context: інший provider з того ж order більше не вважається допустимим target лише через order-level involvement.
- Secure portal messaging between patient and allowed agency peers with client-side `E2E` text envelopes, attachment exchange, notification wire-up, WebSocket chat push, per-message `read_at` timestamps, chat deep-links from the staff notification center and audit trail on conversation view/send/download/read operations.
- DSGVO erasure тепер редагує patient-portal chat payloads через soft-delete/redaction замість повного hard-delete rows.
- Patient feedback / NPS slice with portal survey submission, staff capture/review workspace and promoter / clinic / interpreter ranking.
- Role-scoped SOP / learning library with categories `SOP / handbook / training`, CEO approval for patient-manager-authored content, patient-manager approval for teamlead-interpreter-authored content, acknowledgement requests per revision and scoped operational targeting.

## 5. Як користуватись цим файлом

- Для **узгоджених вимог** дивитись `docs/requirements/*`.
- Для **реального current-state коду** дивитись цей файл разом із regression matrices в `docs/testing/`.
- Якщо з'являється розбіжність між `requirements` і кодом, не переписувати канонічні source-derived документи під код автоматично; спочатку зафіксувати, це свідоме продуктове рішення чи технічний борг.

## 6. Межі цього аудиту

- Це не page-by-page текстовий diff PDF проти markdown.
- Це не повний feature inventory по всіх ~184 user stories.
- Це інженерний current-state зріз по найбільш ризикових місцях, які вже видно з repo, route layer, frontend pages і regression docs.
