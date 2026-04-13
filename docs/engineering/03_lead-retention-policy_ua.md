# Lead retention policy

## Контекст

Кожен lead, що надходить з публічного wizard-у, приносить повний intake payload: імʼя, дата народження, телефон, email, консенти, medical records prompts, primary concern text, attachments, remote IP і user agent. Поки lead не конвертується в пацієнта, ці дані існують у таблиці `leads` **без** бізнес-підстави для довготривалого зберігання.

**GDPR Art. 5(1)(e) — Storage Limitation** вимагає, щоб PII зберігалися лише стільки часу, скільки необхідно для цілі обробки. Для невдалого lead-а ця ціль вичерпується у момент, коли sales вирішує "not qualified" або коли LV/KV не підписано у розумний строк. Підтримувати такий lead у БД роками — *прямий* привід для штрафу від DPA.

Process map клінік-flow-у також чітко це фіксує: дві гілки *"Lead not qualified → Datenlöschung"* і *"LV/KV not signed → Datenlöschung"* у [`Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf`](../Process%20Mapping%20(Kundenjourney%20allg.)(in%20Bearbeitung).pdf).

## Контракт

Система дотримується такого retention SLA для lead-а:

| Стан | Тривалість | Дія |
|---|---|---|
| `new`, `in_progress`, `qualified` | unlimited | PII зберігається доки sales активно працює з lead-ом. |
| `not_qualified`, `archived` (без `failed_outcome_status = 'delete_anonymized'`) | до `cleanup_archived_leads_days` днів після `failed_processed_at` (або `updated_at`, якщо першого немає) | Lead активно існує. Sales може відкрити, переглянути, додати нотатку. |
| `archived` + застарілий понад retention window | — | **Автоматично анонімізується** фоновим sweeper-ом. |
| `archived` + `failed_outcome_status = 'delete_anonymized'` | immutable | Lead у post-purge стані. Імʼя = `'Deleted Lead'`, всі PII поля NULL або sentinel values. |
| `converted` | unlimited | Lead конвертовано у пацієнта — retention перенесено на рівень `patients` (є окремий DSGVO flow у [`admin_compliance.rs`](../../crates/server/src/routes/admin_compliance.rs)). |

Параметр `cleanup_archived_leads_days` зберігається у `system_settings` і за замовчуванням дорівнює **180 днів**. IT-admin може переглянути/змінити його через `/admin/settings` UI. Зміна значення набуває чинності на наступному циклі sweeper-а (≤24 години).

## Архітектура

Три компоненти, три місця в коді:

### 1. Single source of truth для "що таке `delete lead`"

[`routes/leads.rs::anonymize_lead_pii`](../../crates/server/src/routes/leads.rs) — приватний helper, який виконує один великий `UPDATE leads SET first_name = 'Deleted', …` blob з NULL-ами на 40+ PII полях. Цей blob — і є визначення того, що означає "анонімізувати lead" у межах нашої БД.

Викликається з двох місць:
- Manually via [`resolve_failed_lead`](../../crates/server/src/routes/leads.rs) handler з resolution `"delete"`. PM чи CEO явно натискає кнопку.
- Automatically via [`auto_purge_stale_archived`](../../crates/server/src/routes/leads.rs) у фоні, кожні 24 години.

Таким чином manual і automated paths **не можуть розійтися** — якщо хтось додає нове PII поле у схему `leads`, він мусить додати його і в `anonymize_lead_pii`, і обидва шляхи отримують fix одночасно. Це має бути частиною PR checklist.

### 2. Фоновий sweeper

[`main.rs::spawn_lead_purger`](../../crates/server/src/main.rs) запускається при старті сервера:

```rust
gmed_server::routes::invoices::spawn_auto_dunning_scheduler(app_state.clone());
spawn_blacklist_purger(app_state.db.clone());
spawn_message_rewrap_sweeper(app_state.clone());
spawn_lead_purger(app_state.clone());
```

Поведінка:
- **Cadence**: раз на 24 години. Дрібнішa частота додає noise без reward, бо retention window — у днях.
- **Startup**: перший tick пропускається, щоб сервер під час startup не вантажився додатковою DB роботою.
- **Failure mode**: fail-safe. DB error логується як `tracing::error!` і цикл продовжується. **Ніколи не panic і не stop.** Це критично — один "поганий день" не може лишити наступний день без чистки.
- **Logging**: якщо sweep знайшов більше 0 кандидатів, логується `Lead auto-purge sweep complete` з retention_days, scanned, anonymized, errors. Якщо 0 кандидатів — silent (щоб не засмічувати лог).

### 3. Audit trail

Кожен успішно анонімізований lead записує `auto_purge_lead` подію через `state.audit_sender.try_send(audit::domain_event(..))` з context:

```json
{
  "reason": "storage_limitation_retention",
  "retention_days": 180,
  "gdpr_article": "5(1)(e)"
}
```

`user_id = None` — sweeper діє як system actor. `entity_type = "lead"`, `entity_id = <lead_id>`. Ці рядки живуть у `audit_log` (immutable trigger) і можуть бути запитані аудитором одним SQL:

```sql
SELECT count(*), min(created_at), max(created_at)
FROM audit_log
WHERE action = 'auto_purge_lead'
  AND created_at > now() - interval '1 year';
```

Це і є доказ, що retention enforcement *реально* працює — не тільки налаштовано в seed data.

## Що **не** робить цей механізм

Чесна межа:

1. **Не знищує записи leads.** Auto-purger *анонімізує* (NULL-ує PII), але рядок залишається у БД з sentinel `first_name = 'Deleted'`. Це свідомо — інформація про те, **скільки** leads було отримано, звідки (`source`), і коли (`created_at`) залишається для бізнес-аналітики. Під GDPR це прийнятно, бо всі *ідентифікатори* видалено.

2. **Не зачіпає Converted leads.** Якщо lead став пацієнтом, його retention — це retention пацієнта, і воно керується через `admin_compliance.rs` DSGVO workflow (Art. 15/17 — на запит), не через цей sweeper.

3. **Не керує документами пацієнта/інших таблиць.** `patients`, `cases`, `documents`, `invoices` мають власні retention вимоги (Handelsgesetzbuch вимагає 10 років для financial records, медичні картки — 10-30 років залежно від типу). Це окремі policies, не тут.

4. **Не enforceує "soft archive after N days of inactivity".** Зараз активний lead (`new`, `in_progress`) може сидіти роками, якщо sales не закриє його явно. Це окрема proposal — автоматично транзитити неактивні leads у `archived` через, наприклад, 90 днів mowing. **Не реалізовано.** Якщо буде потрібно — додавай у наступний migration as `lead_inactive_auto_archive_days` setting з аналогічним sweeper-ом.

## Testability

Декількарівнева перевірка:

### Pure-function tests (compiled only in test build)

[`routes/leads.rs::auto_purge_tests`](../../crates/server/src/routes/leads.rs) — 9 unit-тестів на `should_auto_purge`, який інкапсулює логіку WHERE-clause у Rust. SQL WHERE clause у `auto_purge_stale_archived` мирає цю логіку 1:1. Якщо ти редагуєш одне — обовʼязково редагуй інше.

Покриті сценарії:
- `archived` / `not_qualified` + вік ≥ retention → purge ✓
- `archived` + вік < retention → keep ✓
- Boundary case: вік **точно** = retention → purge ✓ (Storage Limitation не дає grace day)
- `first_name = 'Deleted'` (sentinel) → skip ✓
- `failed_outcome_status = 'delete_anonymized'` → skip ✓
- `converted` lead → never touch, regardless of age ✓
- `new`, `in_progress` leads → never touch ✓

### Integration test (needs live DB)

Не написано у першій ітерації. TODO: seed lead у `archived` з `failed_processed_at = now() - 200 days`, викликати `auto_purge_stale_archived(&state)`, перевірити що поля NULL, `audit_log` має рядок `auto_purge_lead`, а lead-attachment видалено.

Залишається в беклозі як `T-xxx Lead auto-purge integration test`.

## Як налаштувати retention для конкретного deployment

```sql
-- IT admin змінює retention window на 90 днів:
UPDATE system_settings
   SET value = '90'::jsonb,
       updated_at = now()
WHERE key = 'cleanup_archived_leads_days';
```

Sweeper підхопить нове значення на наступному циклі (≤24 години). Усі leads, які стали застарілими за новим window, будуть анонімізовані у наступному sweep.

**⚠️ Якщо вимкнеш retention** (виставиш на дуже велике число типу 36500 днів) — це порушення GDPR. Документуй у ISMS risk register як "accepted risk" з підставою, або отримуй дозвіл DPO.

## Як перевірити, що sweeper працює

```bash
# У CloudWatch / Loki шукай рядки:
grep "Lead auto-purge sweep complete" <logs>

# У DB: скільки leads у кожному стані
psql "$DATABASE_URL" -c "
SELECT qualification_status,
       failed_outcome_status,
       count(*) AS total,
       count(*) FILTER (WHERE first_name = 'Deleted') AS anonymized
FROM leads
GROUP BY 1, 2
ORDER BY 1, 2;"

# У audit_log: історія auto-purge подій за останній місяць
psql "$DATABASE_URL" -c "
SELECT date_trunc('day', created_at) AS day, count(*)
FROM audit_log
WHERE action = 'auto_purge_lead'
  AND created_at > now() - interval '30 days'
GROUP BY 1
ORDER BY 1;"
```

Якщо у перший прогін (одразу після деплою нового коду) bulk-anonimization здається великим — це нормально. Раніше нічого не чистило, тож є *legacy backlog* leads, які переживали retention window багато разів. Sweeper закриє їх усіх на першому проході.

## Посилання

- Код: [`crates/server/src/routes/leads.rs`](../../crates/server/src/routes/leads.rs) (функції `anonymize_lead_pii`, `auto_purge_stale_archived`, `should_auto_purge`, модуль `auto_purge_tests`)
- Spawner: [`crates/server/src/main.rs`](../../crates/server/src/main.rs) (`spawn_lead_purger`)
- Seed налаштування: [`migrations/20260408000012_security_compliance.sql`](../../migrations/20260408000012_security_compliance.sql) (`cleanup_archived_leads_days = 180`)
- Audit policy: [`docs/engineering/02_audit-migration-policy_ua.md`](02_audit-migration-policy_ua.md)
- Process map (Datenlöschung gates): [`docs/Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf`](../Process%20Mapping%20(Kundenjourney%20allg.)(in%20Bearbeitung).pdf)
- GDPR Art. 5(1)(e), Art. 17 — нормативна основа
- ISO 27001:2022 A.5.33 (Protection of records), A.5.34 (Privacy and PII) — контроль вимог
