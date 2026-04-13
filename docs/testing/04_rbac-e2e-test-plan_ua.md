# RBAC end-to-end test plan

## 1. Мета і scope

Цей документ описує план поетапного покриття **ролей, прав доступу і ізоляції даних** інтеграційними та E2E-тестами. Це *не* unit-рівень — кожен сценарій хоче працювати проти живої (ефемерної) Postgres-БД, проходити повний HTTP pipeline (`require_auth` → `audit::middleware` → route → `check_access`) і робити assertions на реальних запитах/відповідях.

### Чому саме RBAC першим

1. **Security baseline** — жоден інший аспект не має такого впливу на ISO 27001 / GDPR. Помилка у RBAC = PII витік = штраф.
2. **Клієнтський контракт** — замовник сам надіслав `docs/1 (Update 2) User Story Salesforce.xlsx` з **окремою RBAC Matrix вкладкою**. Це обовʼязкова таблиця повноважень, не моя інтерпретація.
3. **Найкращий ROI у регресіях** — типові баги у flow (кнопка не прогрузилась, PDF битий) знаходяться на dev середовищі. А RBAC-баги зазвичай виявляються *в проді*, коли хтось випадково побачив чужого пацієнта.

## 2. Джерела істини

Порядок авторитету — який документ перемагає коли вони розходяться:

1. **`docs/1 (Update 2) User Story Salesforce.xlsx` → вкладка `RBAC Matrix`** — замовник, 10 ролей × 12 data domains. Найвищий авторитет.
2. **`docs/1 (Update 2) User Story Salesforce.xlsx` → вкладка `User Stories`** (184 stories, 24 epics) — контекст і винятки матриці.
3. **[`crates/domain/src/role.rs`](../../crates/domain/src/role.rs)** — enum `Role`, його методи (`has_full_access`, `can_see_medical_data`, `can_see_financial_data`, `can_assign_patients`). Цей код — **поточна реалізація**; якщо розходиться з матрицею, матриця перемагає → код адаптуємо.
4. **[`crates/domain/src/access/policy.rs`](../../crates/domain/src/access/policy.rs)** — pure `check_access(context) → AccessDecision`. Unit-тести вже є (see tests at the bottom of the file). Інтеграційні тести доповнюють їх HTTP-рівнем.
5. **[`docs/Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf`](../Process%20Mapping%20(Kundenjourney%20allg.)(in%20Bearbeitung).pdf)** — workflow constraints (хто кого передає на кому кроці). Використовується для побудови happy-path сценаріїв, не для RBAC як такого.

## 3. RBAC Matrix (нормалізована)

Колонки відображаються на реальні доменні обʼєкти у коді. Символи: ✅ full, 🟡 conditional, 👁️ read-only, ❌ denied, 🎯 scoped (own patients / assigned only).

| Roll (UA)              | Role enum            | Patient data | Documents | Medical info | Appointments | Finance | Comms | Templates | Interp. hrs | VIP svcs | Feedback | SOPs/Learn | Reports |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CEO                    | `Ceo`                | ✅           | ✅        | ✅           | ✅           | ✅      | ✅    | ✅        | 👁️          | 👁️       | ✅       | ✅          | ✅       |
| CEO Assistant          | `CeoAssistant`       | 👁️           | 👁️🟡       | 👁️🟡          | CEO only     | 👁️🟡     | 🟡    | 👁️         | ❌           | 👁️       | 👁️        | partial      | partial  |
| Patient Manager        | `PatientManager`     | 🎯           | 🎯        | 🎯           | 🎯           | 🎯      | 🟡    | 🎯         | 👁️✍️         | 👁️✍️      | ✅       | 🎯           | partial  |
| Teamlead Interpreter   | `TeamleadInterpreter`| 👁️🎯 team    | transl.   | relevant     | interp plan  | ❌      | team  | transl.    | ✅           | ❌        | team fb   | team SOPs    | team KPI |
| Interpreter            | `Interpreter`        | 👁️ basic    | released  | scoped to job| 👁️           | ❌      | job   | transl.    | 🎯 own       | ❌        | own       | own SOPs     | ❌        |
| Concierge              | `Concierge`          | travel/svc   | svc docs  | ❌           | svc plan     | ❌      | svc   | svc        | ❌           | ✅        | svc fb    | own SOPs     | ❌        |
| Billing (Abrechnung)   | `Billing`            | basic        | invoice   | ❌           | ❌           | ✅      | + PM/CEO | invoice | released  | needed   | ❌        | own SOPs     | finance  |
| Sales (Vertrieb)       | `Sales`              | ❌           | ❌        | ❌           | partial agg  | agg     | partner| CRM       | ❌           | ❌        | ❌        | own SOPs     | market   |
| IT Admin               | `ItAdmin`            | ❌ (test)    | ❌        | ❌           | ❌           | ❌      | PM+Bill+CEO | manage | ❌         | ❌        | ❌        | technical    | ❌        |
| Patient                | `Patient`            | own released | own rel.  | own released | own rel.     | own inv | portal | sign own | ❌           | book     | own      | ❌           | own      |

**Легенда детальна:**
- `🎯` = "assigned only" — у policy.rs це `is_assigned: bool` + role вимагає assignment (`require_assignment = true` у таблиці)
- `👁️` = read-only (GET дозволений, POST/PUT/PATCH/DELETE заборонений)
- `🟡` = після release/freigabe (read working тільки з `ShareStatus::ReleasedInternal` / `ReleasedExternal` / `PatientVisible`)
- `✍️` = write дозволено
- `partial` = scoped subset, не всі поля — потребує уточнення у клієнта
- `agg` = тільки агрегати, без per-patient drill-down

## 4. Тестова піраміда

Кожен сценарій попадає в один з трьох шарів:

### 4.1. Rust integration tests — `crates/server/tests/*_api.rs`

**Гарантують:** HTTP → auth middleware → route → `check_access` → DB. Повний backend stack з ефемерною Postgres через `TestSuiteContext` ([`crates/server/tests/support/mod.rs`](../../crates/server/tests/support/mod.rs)).

**Коли писати:** для *кожної* комірки матриці — одна позитивна і одна негативна асерція. Це де живе *джерело істини* для RBAC. Якщо інтеграційний тест пройшов, можна вважати що backend дотримується контракту.

**Швидкість:** ~100-300 мс на тест, повна паралелізація через `#[tokio::test]`, ~500 тестів = ~3-5 хв у CI.

### 4.2. Playwright E2E — `frontend/tests/e2e/*.spec.ts`

**Гарантують:** UI shell — чи приховано кнопку "Convert", чи видно таби "Invoices", чи є hover-tooltip на disabled action. Зараз тести використовують `installStaffApiMocks` (mock API), не живий backend.

**Коли писати:** тільки для UI-visible RBAC — "tab не відрендерений", "кнопка disabled", "banner не показується для ролі X". Якщо backend повертає 403 а UI правильно його обробляє — це Playwright. Якщо треба довести що backend *сам* повертає 403 — це Rust integration.

**Швидкість:** ~2-5 сек на тест, обмежена паралелізація. Fixture — повна кількість mock routes. Варто мати ~20-30 ключових, не 500.

### 4.3. Vitest frontend unit — `frontend/src/**/*.test.ts`

**Гарантують:** pure helpers типу `computeLeadConversionGate`. Вже є 32 тести (8 додано у попередній ітерації).

**Коли писати:** для будь-якої логіки, яка вирішує "показувати/приховувати" на основі ролі + даних. Якщо можна винести у pure function — треба винести.

## 5. Головні принципи coverage

Кожна комірка матриці → **дві асерції**:

**(1) Positive:** "Роль X *може* зробити Y над ресурсом R".
```rust
#[tokio::test]
async fn pm_can_read_assigned_patient() {
    // given: PM assigned to patient P1
    // when: GET /patients/P1 with PM token
    // then: 200, payload contains medical fields
}
```

**(2) Negative:** "Роль X *не може* зробити Y над ресурсом R".
```rust
#[tokio::test]
async fn pm_cannot_read_other_patient() {
    // given: PM assigned to P1; P2 exists unassigned
    // when: GET /patients/P2 with PM token
    // then: 403 OR 404 (dont leak existence)
    //       body does not contain medical fields
}
```

**Чому обидві** — тільки позитивні тести не ловлять ослаблення; тільки негативні не ловлять зломи функціональності. Обовʼязково обидва типи.

## 6. Фази впровадження

Порядок — від найвищого ризику до найнижчого. Кожна фаза — окремий PR.

### 🔴 Phase 1: Auth + session hygiene (10-15 тестів)

Фундамент. Без цього решта тестів взагалі не має сенсу.

- [ ] `auth_login_with_valid_password_issues_tokens`
- [ ] `auth_login_wrong_password_returns_401`
- [ ] `auth_login_unknown_email_returns_401_with_same_timing`
- [ ] `auth_login_inactive_user_returns_403`
- [ ] `auth_login_locked_user_returns_403`
- [ ] `auth_login_auto_locks_after_5_wrong_attempts`
- [ ] `auth_refresh_rotates_tokens_and_blacklists_old`
- [ ] `auth_refresh_theft_detection_revokes_entire_family`
- [ ] `auth_logout_blacklists_current_access_token`
- [ ] `auth_logout_all_revokes_all_user_families`
- [ ] `auth_request_without_token_returns_401_on_protected`
- [ ] `auth_request_with_expired_token_returns_401`
- [ ] `auth_request_with_revoked_token_returns_401`
- [ ] `auth_mfa_pending_login_blocks_token_issue`
- [ ] `auth_mfa_approved_pending_completes_login`

**Harness:** `crates/server/tests/auth_sessions_api.rs` (вже існує — треба розширити).

### 🔴 Phase 2: Per-role smoke (20 тестів, по 2 на роль)

Швидкий sanity check, що кожна з 10 ролей може залогінитись і побачити *щось* / *нічого* згідно з матрицею.

Шаблон:
```
role_{X}_sees_own_surface_on_dashboard  → positive
role_{X}_cannot_access_foreign_surface → negative (typical endpoint from another role)
```

10 × 2 = 20 тестів. Приклад пар:
- CEO: `ceo_can_list_all_patients` / `ceo_can_list_all_invoices`
- Sales: `sales_can_list_leads` / `sales_cannot_list_patients`
- Interpreter: `interpreter_can_list_own_assignments` / `interpreter_cannot_list_invoices`
- Billing: `billing_can_list_invoices` / `billing_cannot_list_medical_cases`
- Patient: `patient_can_read_own_documents_released` / `patient_cannot_list_other_patients`

### 🟠 Phase 3: Patient data RBAC (~40 тестів)

Колонка "Patientendaten" × 10 ролей × 4 operations (read/create/update/delete).

Ключові сценарії:
- [ ] `pm_can_read_own_assigned_patient_full_data`
- [ ] `pm_cannot_read_unassigned_patient`
- [ ] `pm_can_create_patient_and_is_auto_assigned`
- [ ] `pm_can_update_own_assigned_patient`
- [ ] `pm_cannot_update_unassigned_patient`
- [ ] `pm_cannot_delete_patient` (delete reserved for compliance flow, not direct)
- [ ] `ceo_can_read_any_patient`
- [ ] `ceo_can_update_any_patient`
- [ ] `ceo_assistant_can_read_patient_identity_only_after_release`
- [ ] `ceo_assistant_cannot_read_medical_before_release`
- [ ] `concierge_can_read_patient_service_and_travel_fields`
- [ ] `concierge_cannot_read_patient_medical_fields` — **field-level filter test**, not just endpoint block
- [ ] `billing_can_read_patient_basic_data`
- [ ] `billing_cannot_read_patient_medical_fields`
- [ ] `sales_cannot_list_patients`
- [ ] `it_admin_cannot_read_production_patient_fields` (only test fixtures allowed)
- [ ] `interpreter_can_read_assigned_patient_basic_data`
- [ ] `interpreter_cannot_read_financial_fields`
- [ ] `patient_can_read_own_data_only`
- [ ] `patient_cannot_read_other_patient_data` (existence leak test)

**Fixture потрібний:** `seed_patient_with_assignments(pool, patient_name, assigned_to_user_ids)` — helper, що створює пацієнта і встановлює patient_assignments для заданих ролей.

### 🟠 Phase 4: Document / release flow (~30 тестів)

Колонка "Dokumente & Scans" × 10 ролей × {upload, read_internal, read_released, share_to_provider, release_to_portal, revoke_release}.

Критична частина: **ShareStatus lifecycle** (`InternalOnly` → `ReleasedInternal` → `ReleasedExternal` → `PatientVisible`).

- [ ] `pm_can_upload_document_to_assigned_patient`
- [ ] `pm_cannot_upload_document_to_unassigned_patient`
- [ ] `pm_can_release_document_to_patient_portal`
- [ ] `pm_can_revoke_document_release`
- [ ] `interpreter_sees_document_only_after_released_internal`
- [ ] `interpreter_does_not_see_internal_only_document`
- [ ] `patient_sees_document_only_after_patient_visible`
- [ ] `patient_cannot_upgrade_share_status_via_api` (direct tamper test)
- [ ] `patient_can_sign_document_addressed_to_self_only`
- [ ] `billing_can_read_invoice_documents`
- [ ] `billing_cannot_read_medical_documents_even_if_released`
- [ ] `concierge_can_read_service_category_documents_only`
- [ ] `ceo_can_read_any_document_any_status`
- [ ] `sales_cannot_read_any_document`
- [ ] `document_share_to_provider_requires_share_status_released_external`
- [ ] `document_share_to_non_medical_provider_blocks_medical_docs`
- [ ] `document_audit_log_contains_every_view_access` — **audit coverage test**, проходить навіть якщо RBAC правильний

### 🟠 Phase 5: Appointment + interpreter assignment (~25 тестів)

"Termine" + "Dolmetscherberichte & Stunden" колонки. Має бути тісно повʼязаний з Phase 3 (приписаність до пацієнта).

- [ ] `pm_can_create_appointment_for_assigned_patient`
- [ ] `pm_cannot_create_appointment_for_unassigned_patient`
- [ ] `pm_can_assign_interpreter_to_own_appointment`
- [ ] `pm_cannot_assign_interpreter_to_appointment_of_other_pm`
- [ ] `interpreter_can_read_own_assigned_appointment`
- [ ] `interpreter_cannot_read_unassigned_appointment`
- [ ] `interpreter_can_submit_own_hours`
- [ ] `interpreter_cannot_submit_hours_for_other_interpreter`
- [ ] `teamlead_interpreter_can_approve_team_hours`
- [ ] `teamlead_interpreter_cannot_approve_hours_from_other_team`
- [ ] `ceo_can_see_all_appointments_all_teams`
- [ ] `concierge_can_read_appointment_service_fields_only`
- [ ] `billing_cannot_read_appointments`
- [ ] `patient_portal_can_request_appointment_but_not_finalize`
- [ ] `patient_portal_request_creates_pending_status_only`
- [ ] `appointment_series_split_preserves_per_occurrence_permissions`
- [ ] `cancel_appointment_series_requires_pm_or_ceo`

### 🟠 Phase 6: Financial isolation (~25 тестів)

Колонка "Finanzen" — сама чутлива після medical, бо штраф від Finanzamt за misreport. Тут все крутиться навколо `role.can_see_financial_data()`.

- [ ] `billing_sees_all_invoices_all_patients`
- [ ] `billing_can_create_invoice`
- [ ] `billing_can_update_invoice_status`
- [ ] `billing_cannot_see_medical_case_contents`
- [ ] `pm_sees_only_own_patient_invoices`
- [ ] `pm_cannot_update_invoice_financial_fields` (може лише prep)
- [ ] `ceo_sees_all_invoices`
- [ ] `ceo_sees_all_dunning_events`
- [ ] `sales_sees_only_aggregated_revenue_kpis_no_per_patient`
- [ ] `interpreter_cannot_see_any_invoice`
- [ ] `concierge_cannot_see_any_invoice`
- [ ] `patient_sees_only_own_invoices`
- [ ] `patient_cannot_see_other_patient_invoices_via_scoped_url`
- [ ] `patient_can_download_own_invoice_pdf`
- [ ] `patient_cannot_download_other_patient_invoice_pdf`
- [ ] `invoice_create_denies_19pct_vat_override_for_medical_service` — **regulatory check**: примусово валідує §4 UStG класифікацію (TODO: ця вимога ще не у коді, треба спочатку додати)

### 🟡 Phase 7: Lead → Patient conversion (~15 тестів)

Вже частково покрито, але треба добити:

- [ ] `sales_can_create_lead`
- [ ] `sales_cannot_convert_lead_to_patient`
- [ ] `sales_can_qualify_lead`
- [ ] `pm_can_convert_qualified_lead`
- [ ] `pm_cannot_convert_unqualified_lead`
- [ ] `pm_cannot_convert_lead_missing_dob`
- [ ] `pm_cannot_convert_lead_missing_consent_healthcare`
- [ ] `pm_cannot_convert_lead_missing_consent_privacy`
- [ ] `pm_cannot_convert_already_converted_lead`
- [ ] `pm_cannot_convert_failed_lead`
- [ ] `converted_lead_auto_assigns_pm_to_new_patient`
- [ ] `converted_lead_bootstraps_default_workflow_checklist`
- [ ] `converted_lead_emits_audit_log_event`
- [ ] `convert_lead_requires_first_vorkasse_paid` — **TODO before writing**: process-map гап, зараз не enforced
- [ ] `list_leads_conversion_ready_reflects_missing_fields_per_field` — пара вже є, треба розширити

### 🟡 Phase 8: Communication + messaging (~20 тестів)

Колонка "Kommunikation". Особливо важливо — E2E encryption і share scope.

- [ ] `pm_can_message_assigned_patient`
- [ ] `pm_cannot_message_unassigned_patient`
- [ ] `patient_portal_can_read_own_messages_only`
- [ ] `patient_portal_cannot_read_other_patient_messages`
- [ ] `interpreter_can_read_job_related_messages_only`
- [ ] `billing_can_message_pm_and_ceo_only`
- [ ] `concierge_can_message_service_scope_only`
- [ ] `sales_can_message_partner_providers_only`
- [ ] `message_encryption_roundtrip_preserves_content`
- [ ] `message_attachment_scan_blocks_malicious_upload`
- [ ] `message_redaction_via_dsgvo_request_clears_body`

### 🟡 Phase 9: Admin, compliance, system (~20 тестів)

- [ ] `it_admin_can_manage_users_but_not_read_patient_data`
- [ ] `it_admin_can_reset_password_without_reading_profile`
- [ ] `it_admin_can_manage_ip_whitelist`
- [ ] `it_admin_cannot_read_audit_log_content` (вважається compliance data)
- [ ] `ceo_can_read_audit_log`
- [ ] `dsgvo_export_creates_patient_archive`
- [ ] `dsgvo_export_requires_pm_or_ceo_role`
- [ ] `dsgvo_anonymize_is_irreversible_and_logged`
- [ ] `privacy_request_workflow_requires_review_before_execute`
- [ ] `consent_revoke_invalidates_scoped_access`
- [ ] `auto_purge_stale_lead_respects_retention`
- [ ] `auto_purge_emits_audit_log_event`

### 🟢 Phase 10: UI shell checks via Playwright (~20 тестів)

Тільки те що *не* перевіряється на рівні HTTP. Кожен тест мокає роль через `installStaffApiMocks`.

- [ ] `ceo_sees_full_nav` — бачить всі нав-таби
- [ ] `ceo_assistant_hides_medical_tabs_on_patient_profile` (вже є)
- [ ] `sales_sees_leads_nav_but_not_patients_nav`
- [ ] `billing_sees_invoices_nav_but_not_medical_cases_nav`
- [ ] `interpreter_sees_assignments_nav_only`
- [ ] `concierge_sees_services_nav_only`
- [ ] `pm_lead_card_convert_blocked_disabled_with_tooltip` (вже є)
- [ ] `pm_lead_card_convert_ready_enabled` (вже є)
- [ ] `it_admin_sees_user_management_nav_only`
- [ ] `patient_portal_sees_documents_invoices_appointments_nav`
- [ ] `patient_portal_does_not_see_any_staff_nav`

## 7. Спільні fixtures і seed helpers (до Phase 1)

Перед стартом Phase 1 треба добудувати `crates/server/tests/support/mod.rs`:

```rust
pub async fn seed_user_with_password(pool: &PgPool, role: &str, password: &str) -> (Uuid, String)
pub async fn login_as(app: &Router, email: &str, password: &str) -> String /* bearer */
pub async fn issue_token_for(user_id: Uuid, role: &str) -> String /* bypass password */
pub async fn seed_patient_with_assignments(
    pool: &PgPool,
    label: &str,
    assignee_ids: &[(Uuid, &str)],
) -> Uuid
pub async fn seed_lead(pool: &PgPool, overrides: LeadSeedOverrides) -> Uuid
pub async fn seed_invoice_for_patient(pool: &PgPool, patient_id: Uuid) -> Uuid
pub async fn seed_document(pool: &PgPool, patient_id: Uuid, share_status: &str) -> Uuid
pub async fn seed_appointment(
    pool: &PgPool,
    patient_id: Uuid,
    interpreter_id: Option<Uuid>,
) -> Uuid
```

Усі fixture-функції мають дотримуватись трьох правил:

1. **Ідемпотентні до БД:** ніколи не пишуть у global state. Кожен тест має свою ефемерну БД через `TestSuiteContext`.
2. **Повертають ідентифікатори, не DTO:** щоб тест сам вирішував що перевіряти на тому ресурсі.
3. **Не залежать один від одного:** `seed_appointment` не викликає `seed_patient` всередині. Тест явно передає patient_id.

## 8. Відкриті питання клієнту

Матриця має 4 позиції, які потребують уточнення **до того** як писати тести. Інакше тест напишемо, а аудитор скаже "це не те".

1. **Sales + Finanzen = "Auswertung und Analyse".** Чи це per-invoice read-only, чи тільки агрегати (revenue by month, etc.)? Я зараз інтерпретую як **тільки агрегати**. Треба підтвердити.
2. **Sales + Termine = "Teilzugriff zur Auswertung".** Аналогічно — per-appointment read чи агрегати? Імовірно агрегати (booking velocity), але треба підтвердити.
3. **CEO + Dolmetscherberichte = "Lesen" (read-only).** Тобто CEO не може *скасувати* або *виправити* interpreter hours? Мені це дивно — CEO зазвичай має full. Може у замовника це означає "не підписує власноруч". Треба уточнити.
4. **IT-Admin + Patientendaten = "Testdaten only".** Чи є технічна відмінність між "production row" і "test row"? Зараз у схемі її немає — усі `patients` рядки однакові. Потрібне рішення:
   - (a) Додати колонку `is_test_data BOOLEAN DEFAULT FALSE` і блокувати IT-Admin доступ до `FALSE` рядків.
   - (b) Винести test data у окрему схему / namespace.
   - (c) Трактувати це як **заборонено взагалі** для IT-Admin у production.
   - Моя рекомендація: **(c)** — заборонити IT-Admin читати будь-які patient-рядки у production, використовувати окреме staging оточення для test data. Простіше і безпечніше.

**Ці 4 питання мають піти замовнику перед Phase 3.** Phase 1 і 2 не залежать від них.

## 9. Підрахунок

| Фаза | Тестів | Тип | Орієнтовні дні | Залежності |
|---|---|---|---|---|
| 1 — Auth | 15 | Rust integration | 2-3 | support helpers |
| 2 — Per-role smoke | 20 | Rust integration | 2 | Phase 1 |
| 3 — Patient data RBAC | 40 | Rust integration | 5-6 | Phase 1, client Q1-Q4 |
| 4 — Documents / release | 30 | Rust integration | 4-5 | Phase 3 |
| 5 — Appointments / interpreter | 25 | Rust integration | 3-4 | Phase 3 |
| 6 — Financial isolation | 25 | Rust integration | 3-4 | Phase 3, client Q1 |
| 7 — Lead conversion | 15 | Rust integration | 2 | Phase 1 |
| 8 — Communication / messaging | 20 | Rust integration | 3 | Phase 3 |
| 9 — Admin / compliance | 20 | Rust integration | 3 | Phase 1 |
| 10 — UI shell (Playwright) | 20 | Playwright | 3-4 | Phase 2 |
| **Всього** | **~230** | — | **30-37 днів** | — |

Це близько **7-8 тижнів** роботи для одного інженера, працюючого full-time тільки над тестами. Якщо розпаралелити з іншою роботою — 3-4 місяці календарного часу.

**ROI-оптимальна точка:** після Phase 3 (patient data RBAC) — це ~75 тестів і ~10 днів. Закриває 80% compliance-критичного ризику. Phase 4-9 — довантаження до full coverage.

## 10. Як запускати

```bash
# Однократно — стартувати Postgres для тестів (docker-compose.yml вже є)
docker compose up -d db

# Змінні
export DATABASE_URL=postgres://gmed:gmed@localhost:5432/gmed
export TEST_DATABASE_ADMIN_URL=postgres://gmed:gmed@localhost:5432/postgres

# Один файл
cargo test -p gmed-server --test auth_sessions_api

# Весь RBAC набір
cargo test -p gmed-server --test '*_api'

# Playwright
npm --prefix frontend run test:e2e
```

**CI:** існуючий `cargo test --workspace` з `SQLX_OFFLINE=true` не виконує ці тести (вони silently skip через відсутність `TEST_DATABASE_ADMIN_URL`). Треба додати окремий job `rust-integration` який підіймає Postgres через `services:` у GitHub Actions і ганяє тести. Це окрема задача **T-1xx** до Phase 1.

## 11. Посилання

- [RBAC Matrix Excel](../1%20(Update%202)%20User%20Story%20Salesforce.xlsx) — вкладка `RBAC Matrix`
- [User Stories Excel](../1%20(Update%202)%20User%20Story%20Salesforce.xlsx) — вкладка `User Stories`, 184 items, 24 epics
- [Role enum](../../crates/domain/src/role.rs)
- [Access policy function](../../crates/domain/src/access/policy.rs) + її unit tests
- [Data sensitivity classification](../../crates/domain/src/access/data_sensitivity.rs)
- [ShareStatus lifecycle](../../crates/domain/src/access/share_status.rs)
- [TestSuiteContext harness](../../crates/server/tests/support/mod.rs)
- [Process map PDF](../Process%20Mapping%20(Kundenjourney%20allg.)(in%20Bearbeitung).pdf) — workflow contextual constraints
- [Audit policy doc](../engineering/02_audit-migration-policy_ua.md) — audit assertions baseline
- [Lead retention policy doc](../engineering/03_lead-retention-policy_ua.md) — retention assertions baseline
