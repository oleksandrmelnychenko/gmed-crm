# Lead retention policy

## Контекст

Кожен lead, що надходить з публічного wizard-у, приносить повний intake payload: імʼя, дата народження, телефон, email, консенти, medical records prompts, primary concern text, attachments, remote IP і user agent. Поки lead не конвертується в пацієнта, ці дані існують у таблиці `leads` **без** бізнес-підстави для довготривалого зберігання.

**GDPR Art. 5(1)(e) — Storage Limitation** вимагає, щоб PII зберігалися лише стільки часу, скільки необхідно для цілі обробки. Для невдалого lead-а ця ціль вичерпується у момент, коли sales вирішує "not qualified" або коли LV/KV не підписано у розумний строк. Підтримувати такий lead у БД роками — *прямий* привід для штрафу від DPA.

Process map клінік-flow-у також чітко це фіксує: дві гілки *"Lead not qualified → Datenlöschung"* і *"LV/KV not signed → Datenlöschung"* у [`Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf`](../Process%20Mapping%20(Kundenjourney%20allg.)(in%20Bearbeitung).pdf).

## Контракт

Система дотримується такого retention SLA для lead-а:

| Стан | Тривалість | Дія |
|---|---|---|
| `new`, `in_progress`, `not_qualified`, `archived` **без підписаної згоди DSGVO** (`compliance_status <> 'signed'`) | `unqualified_lead_retention_days` (14 днів) від створення lead-а | **Автоматично видаляється разом з усіма документами** (розділ «Некваліфікований lead без згоди»). |
| `qualified`, а також будь-який lead з підписаною згодою | unlimited | PII зберігається доки sales активно працює з lead-ом. |
| `not_qualified`, `archived` (без `failed_outcome_status = 'delete_anonymized'`) | до `cleanup_archived_leads_days` днів після `failed_processed_at` (або `updated_at`, якщо першого немає) | Lead активно існує. Sales може відкрити, переглянути, додати нотатку. |
| `archived` + застарілий понад retention window | — | **Автоматично анонімізується** фоновим sweeper-ом; документи, вкладення і prospect-пацієнт видаляються так само, як у 14-денному правилі. |
| `archived` + `failed_outcome_status = 'delete_anonymized'` | immutable | Lead у post-purge стані. Імʼя = `'Deleted Lead'`, всі PII поля NULL або sentinel values. |
| `converted` | unlimited | Lead конвертовано у пацієнта — retention перенесено на рівень `patients` (є окремий DSGVO flow у [`admin_compliance.rs`](../../crates/server/src/routes/admin_compliance.rs)). |

Параметр `cleanup_archived_leads_days` зберігається у `system_settings` і за замовчуванням дорівнює **180 днів**. IT-admin може переглянути/змінити його через `/admin/settings` UI. Зміна значення набуває чинності на наступному циклі sweeper-а (≤24 години).

## Некваліфікований lead без згоди (14 днів)

Рішення власника від 2026-10-01: lead, який за 14 днів не кваліфікувався і не має підписаної згоди DSGVO, не має правової підстави для зберігання — особливо його медичних файлів (Art. 9 DSGVO). Тому він видаляється автоматично.

**Кого стосується** (`UNQUALIFIED_LEAD_SUBJECT_SQL`):

- `qualification_status` ∈ `new`, `in_progress`, `not_qualified`, `archived`;
- `compliance_status <> 'signed'` — підписана згода зупиняє правило;
- lead не конвертовано (`converted_patient_id IS NULL`) і ще не анонімізовано.

**Строк**: `GREATEST(created_at, unqualified_lead_retention_effective_at) + unqualified_lead_retention_days`. Момент `effective_at` записує міграція під час першого розгортання, тож lead-и, що існували до ввімкнення правила, отримують повні 14 днів, а не зникають першої ж ночі. `unqualified_lead_retention_days = 0` вимикає правило.

**Що видаляється** (`purge_lead_and_prospect_in_tx`, одна транзакція):

1. відкритий підготовчий order lead-а відкликається (як при ручному видаленні);
2. документи lead-а і його prospect-пацієнта — рядки `documents` і файли у сховищі; рахунки та підписані договори лишаються (§ 147 AO, § 257 HGB);
3. `lead_attachments`, сповіщення про lead, значення custom-полів, непідписаний рамковий договір;
4. prospect-пацієнт — видаляється повністю; якщо на нього посилаються записи, які не можна видалити, анонімізується тим самим кодом, що й Art. 17 (`anonymize_patient_identity`);
5. вхід пацієнта, створений разом із lead-ом (`leads.portal_user_id`, рішення власника 2026-10-03), вимикається: `is_active = false`, email і ім'я замінюються (`deleted-lead-<id>@invalid`, `Deleted lead`), пароль стає випадковим, сесії й незавершені входи відкликаються, подія audit `disable_lead_portal_account`. Рядок `users` лишається, бо на нього посилаються audit і документи. Якщо акаунт уже належить пацієнтові (конвертація чи повторний пацієнт), знімається лише зв'язок з lead-ом. Те саме відбувається при ручному видаленні lead-а і за правилом 180 днів (усі шляхи йдуть через `purge_lead_and_prospect_in_tx`), тож email знову вільний для нового lead-а;
6. дані кабінету ліда ([`architecture/lead-patient-portal_ua.md`](../architecture/lead-patient-portal_ua.md)): позначки полів від пацієнта (`portal_field_updates`), час відправки, рядки `lead_portal_uploads`; доступи батьків (`lead_portal_access`) відкликаються, а вхід батьків без інших активних зв'язків (інша заявка, запис пацієнта, власний лід) вимикається й анонімізується так само. Згоди з порталу (`consent_records` з `lead_id`) лишаються як доказ. Згода «на обробку даних заявки» в порталі **не** зупиняє це видалення — лише підписаний документ DSGVO; Власні заяви ліда за GwG (`lead_gwg_declarations`) і завантажені копії документа особи (`lead_portal_uploads.kind = 'identity'`) видаляються там само. Позначки персоналу про платіж із власного рахунку (`lead_identification_payments`, § 12 Abs. 1 GwG) видаляються разом із ними — і позначки пацієнта чи платника, і позначки законних представників неповнолітнього (`representative:<id>`). Дані про представників із кабінету (фаза 1b-2) ідуть тим самим шляхом: рядки `lead_representatives` неконвертованого ліда видаляє `anonymize_lead_pii` (разом із ними — реєстрові рядки `lead_portal_uploads` видів `representative_identity` і `representative_authority`), довірені особи зникають із `trusted_contacts`, а самі файли (скан документа представника, довіреність, Bestellungsurkunde, підтвердження опіки) видаляються з документами ліда. Відповіді про представництво (`has_representative`, `under_guardianship`, `custody`) — колонки `lead_gwg_declarations` і видаляються з нею. Рядки конвертованого ліда лишаються з діловими відносинами, як декларація платника.
7. сам рядок `leads` лишається порожньою міткою (`first_name = 'Deleted'`, без PII, `wizard_state = {}`) — для статистики кількості звернень.

**Що блокує автоматичне видалення**: order lead-а має рахунок (вихідний або рахунок постачальника) або order не вдалося відкликати. Такий lead не чіпається, а PM і CEO отримують сповіщення `lead_retention_blocked` (не частіше ніж раз на 7 днів) — рішення приймає людина.

**Попередження**: за 3 дні до строку автор lead-а (для lead-ів із сайту — PM і CEO) отримує сповіщення `lead_retention_warning`; позначка `leads.retention_warning_sent_at` гарантує одне попередження. API повертає `retention_deadline_at` у списку і в картці; UI показує «Удаление через N дн» у колонці «Автоудаление», у шапці картки і банером у wizard-і.

**Audit**: подія `auto_purge_lead` з `reason = "unqualified_lead_retention"`, `retention_days`, `gdpr_article = "5(1)(e)"`, `failed_from_status`.

**Тести**: модуль `unqualified_lead_retention_tests` (межі строку) і інтеграційний `an_unqualified_lead_without_consent_is_purged_with_everything_it_owns` у [`crates/server/tests/leads_api.rs`](../../crates/server/tests/leads_api.rs).

## Архітектура


Три компоненти, три місця в коді:

### 1. Single source of truth для "що таке `delete lead`"

[`routes/leads.rs::anonymize_lead_pii`](../../crates/server/src/routes/leads.rs) — приватний helper, який виконує один великий `UPDATE leads SET first_name = 'Deleted', …` blob з NULL-ами на 40+ PII полях. Цей blob — і є визначення того, що означає "анонімізувати lead" у межах нашої БД.

Викликається з трьох місць:
- Manually via [`resolve_failed_lead`](../../crates/server/src/routes/leads.rs) handler з resolution `"delete"`. PM чи CEO явно натискає кнопку.
- Automatically via [`auto_purge_stale_archived`](../../crates/server/src/routes/leads.rs) у фоні, кожні 24 години.
- Automatically via [`auto_purge_unqualified_leads`](../../crates/server/src/routes/leads.rs) у тому самому фоновому циклі (14-денне правило).

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

3. **Не керує документами конвертованого пацієнта/інших таблиць.** Документи некваліфікованого lead-а і його prospect-пацієнта видаляються разом з lead-ом (див. вище), але `patients`, `cases`, `documents`, `invoices` справжнього пацієнта мають власні retention вимоги (Handelsgesetzbuch вимагає 10 років для financial records, медичні картки — 10-30 років залежно від типу). Це окремі policies, не тут.

4. **Не обмежує lead з підписаною згодою або у статусі `qualified`.** Такий lead може лишатися активним без строку, доки sales не закриє його явно; після закриття діє 180-денне правило.

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

14-денне правило покрите тестом `an_unqualified_lead_without_consent_is_purged_with_everything_it_owns`: lead з документом, вкладенням і prospect-пацієнтом після sweep-у лишається порожньою міткою, файли й рядки видалено; lead з підписаною згодою і свіжий lead не зачеплені.

Для 180-денного правила окремого інтеграційного тесту немає; воно використовує той самий `purge_lead_and_prospect_in_tx`.

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
- 14-денне правило: [`migrations/20261001203000_unqualified_lead_retention.sql`](../../migrations/20261001203000_unqualified_lead_retention.sql) (`unqualified_lead_retention_days = 14`, `unqualified_lead_retention_effective_at`)
- Audit policy: [`docs/engineering/02_audit-migration-policy_ua.md`](02_audit-migration-policy_ua.md)
- Process map (Datenlöschung gates): [`docs/Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf`](../Process%20Mapping%20(Kundenjourney%20allg.)(in%20Bearbeitung).pdf)
- GDPR Art. 5(1)(e), Art. 17 — нормативна основа
- ISO 27001:2022 A.5.33 (Protection of records), A.5.34 (Privacy and PII) — контроль вимог
