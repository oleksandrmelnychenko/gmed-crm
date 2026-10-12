# Audit log migration policy

## Контекст

`audit_log` — це append-only таблиця в `migrations/20260407000001_initial_schema.sql`, захищена тригером `audit_log_immutable` від `UPDATE` / `DELETE`. Вона є основним свідченням для ISO 27001 A.8.15 і BSI C5 OPS-15 — "хто, коли і що зробив із PHI".

Історично кожен handler писав у `audit_log` напряму — `INSERT INTO audit_log (...) VALUES (...)`. Це працювало, але мало два мінуси:

1. **Покриття не доводилось.** Аудитор міг запитати "покажіть, що *кожен* доступ до медичних даних залоговано", і ми не могли дати однозначну відповідь — частина routes писали, частина ні, і це треба було перевіряти grep-ом.
2. **Розкидана семантика.** Сто плюс call-sites, кожен трохи інакше формував context JSON, action string і entity_type.

Ми перейшли на єдиний writer — модуль [`crates/server/src/audit.rs`](../../crates/server/src/audit.rs). Покриття гарантує middleware на `protected` дереві маршрутів. Семантику handlers додають через `AuditContext` extension або шляхом виклику `state.audit_sender.try_send(audit::domain_event(..))` для додаткових подій усередині мульти-крокових flow.

## Ratchet

`scripts/check_repo_hygiene.py` тримає константу `AUDIT_INSERT_BUDGET`. Ця константа дорівнює *поточній* кількості рядків `INSERT INTO audit_log` під `crates/server/src/routes/`. CI hygiene job:

- падає, якщо знайшов **більше** ніж бюджет → нові ручні INSERT-и заборонені, користуйся `audit::domain_event` / `AuditContext`;
- падає, якщо знайшов **менше** ніж бюджет → ти мігрував кілька сайтів і маєш у тому ж коміті оновити константу.

Ratchet рухається тільки вниз. Кожен migration commit обов'язково чіпає `check_repo_hygiene.py` — це робить його видимим у diff і ревью.

На момент написання документа `AUDIT_INSERT_BUDGET = 6`.

## Що залишилось у бюджеті — і чому

Шість INSERT-ів у двох файлах не мігровано і **не повинні бути мігровані без перебудови архітектури**:

### `crates/server/src/routes/sops.rs` (4)

- `create_sop`
- `update_sop`
- `review_sop`
- `request_sop_acknowledgement`

Усі чотири виконуються через `.execute(&mut *tx)` всередині однієї SQL-транзакції разом із бізнес-мутацією SOP. Якщо бізнес-мутація провалюється і транзакція rollback-ається, audit row рольбекається разом із нею. Це і є коректна поведінка для `create_sop`-style операцій: якщо SOP не створено, не повинно бути audit row який стверджує що він був створений.

`AuditSender::try_send` ставить подію в mpsc-черга **після** того, як HTTP response повернувся, *поза* будь-якою handler-owned транзакцією. Якщо мігрувати ці чотири на try_send:

1. Handler починає транзакцію, INSERT-ить SOP row.
2. Handler ставить audit подію в чергу.
3. Handler намагається commit, отримує DB error, повертає 500.
4. Mpsc writer бачить подію в черзі, пише `audit_log` row про "SOP створено" — **який насправді не існує в `sops` таблиці**.

Це робить audit log брехливим. Для compliance це гірше ніж відсутність row.

### `crates/server/src/routes/contracts.rs` (2)

- `create_quote` — один `INSERT ... SELECT` пише рядок `create_quote` і по рядку `supersede_quote` (зі старим і новим статусом) для кожного попереднього відкритого кошторису замовлення, який новий кошторис закрив статусом `superseded`
- `update_quote_status`

Та ж сама причина — обидва INSERT-и виконуються через `.execute(&mut *tx)` всередині транзакції з мутацією quote.

## Альтернативи, які ми НЕ обрали

### Альтернатива A — пере-проєктувати middleware щоб поважати handler tx

Зробити так, щоб handler міг "оголосити" audit подію всередині транзакції, і middleware мав чекати committed/aborted перед записом. Це вимагає:

- Передавати `&mut Transaction` через extension в middleware
- Middleware має знати, чи commit вдався
- Розв'язувати випадки, коли handler сам виконав commit — як це detect

Це додає 200+ рядків інфраструктури і нову вісь складності для вирішення проблеми, яку зараз вирішують 6 рядків raw SQL.

### Альтернатива B — фоновий dedup-loop

Писати audit подію через try_send, а одночасно зберігати у tx маркер ID. Фоновий процес перевіряє, чи маркер існує, і якщо ні — видаляє audit подію. Але `audit_log` immutable, видаляти не можна.

### Альтернатива C — двофазний commit

Application-level 2PC між audit таблицею та бізнес таблицею. Overengineered.

## Прийнята позиція

**Шість transaction-coupled audit inserts є legitimate exceptions.** Вони:

- виконують безпечнішу поведінку (rollback разом з бізнес-логікою),
- задокументовані з `TODO(audit-migrate)` коментарями і причиною,
- визнані ratchet-бюджетом (`= 6`),
- описані в цьому документі.

Для аудитора це готова відповідь на запитання "чому ці шість не мігровані":

> Ці записи мають transactional coupling зі своєю бізнес-мутацією. Це гарантує, що audit row існує тоді і тільки тоді, коли бізнес-мутація committed. Альтернатива — eventual delivery через mpsc — може створити audit row для транзакції, яка rollback-нулась, що погіршує цілісність compliance evidence. Свідомий compromise.

## Нові handlers — як писати audit правильно

### Випадок 1: один HTTP запит → одна audit подія, без транзакцій

Робити нічого не треба. Middleware на `protected` дереві сама напише `http_request` row з matched route і user_id. Опційно handler може *збагатити* подію через `AuditContext`:

```rust
async fn read_patient(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Extension(audit): Extension<audit::AuditContext>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    audit.set_action("read_patient");
    audit.set_entity("patient", id);
    // ... handler logic
}
```

### Випадок 2: мульти-крокова flow → декілька audit подій per request

Викликай `audit::domain_event` напряму через `state.audit_sender.try_send(..)`:

```rust
state.audit_sender.try_send(audit::domain_event(
    "anonymize_patient",
    Some(actor_id),
    "patient",
    Some(patient_id),
    json!({ "article": "Art. 17" }),
));
```

Це створить **додатковий** audit row поверх того, що напише middleware. Використовується для мульти-крокових privacy/compliance flows.

### Випадок 3: diff-style audit (old/new snapshots)

Використовуй `audit::domain_diff_event`:

```rust
state.audit_sender.try_send(audit::domain_diff_event(
    "update_user",
    Some(auth.user_id),
    "user",
    Some(user_id),
    old_snapshot_json,
    new_snapshot_json,
));
```

`old_value` і `new_value` потрапляють у відповідні колонки `audit_log`.

Персональні дані пацієнта, ліда чи платника (телефон, адреса, страхування, паспорт, нотатки, медичні поля) **не** кладуть у `old_value` / `new_value` чи `context`: журнал append-only і переживає стирання за ст. 17 DSGVO, тож копія даних у ньому залишилася б після анонімізації. Для зміни таких записів аудит називає лише змінені поля — `context.changed_fields` (як `update_patient` з 2026-10-11, QA B-26, і `lead_portal_update_personal_data`), без значень. Називаються лише справді змінені поля (QA 2026-10-12 B2-13): назва країни й її ISO-код («Deutschland» / `DE`) — та сама країна; громадянство, яке редактор профілю заповнює з національності для запису без списку громадянств, — не зміна; `contacts` — лише коли список контактів змінився більше, ніж уже названі `phone_primary`, `phone_secondary`, `email` (для запису без рядків контактів порівнюються контакти, складені з цих полів). Зміна лише телефону — `["phone_primary"]`. Хронологія картки пацієнта показує з цього подію «Профиль изменён: <поля>»; подію «Изменён юридический статус» — лише коли значення правового статусу справді змінилося (`context.legal_status_changed_keys`, `legal_status_updated`). Старі рядки `update_patient` (до 2026-10-11, без `changed_fields`) мали `legal_status_updated = true` при кожному збереженні профілю; їх не переписують (append-only), а хронологія показує їх нейтрально як «Профиль изменён», якщо `contract_status` чи `compliance_completed` не відрізняються від попереднього рядка `update_patient` того ж пацієнта. Diff зі значеннями (`domain_diff_event`) лишається для службових даних, як-от акаунтів персоналу (`update_user`).

### Випадок 4: audit має бути транзакційний

Для нового коду використовуй `audit::write_in_transaction(&mut tx, &audit::domain_event(..))`: той самий єдиний writer модуля `audit.rs`, але в транзакції виклику — audit row комітиться або відкочується разом зі зміною і не губиться при переповненому каналі. Так пишуть audit зміни прив'язок перекладачів до пацієнтів через бронювання (`crates/server/src/services/interpreter_booking_links.rs`). Бюджет ratchet це не змінює.

Існуючі raw SQL `INSERT INTO audit_log` всередині `.execute(&mut *tx)` залиш як є. Додай `// TODO(audit-migrate): transactional — coupled to <X> rollback. Do not migrate.` коментар перед INSERT, щоб майбутній рев'юер бачив, що це усвідомлений виняток.

Новий raw INSERT у `routes/` піднімає `AUDIT_INSERT_BUDGET` у `scripts/check_repo_hygiene.py` на 1 (так, ratchet рухається вниз — але якщо твій випадок legitimate, ти можеш йому *тимчасово* підняти бюджет; це викличе обговорення в ревью, що і потрібно).

## Append-only історія задач і виняток для стирання (Art. 17 DSGVO)

Історія задач (`concierge_operational_task_events`) — теж append-only: тригер `prevent_concierge_task_append_only_mutation` відмовляє в `UPDATE` і `DELETE`. Її payload повторює попередні тексти: попередній текст відредагованого чи видаленого коментаря, попередній текст пункту чек-листа, назви файлів вкладень, колишні назви задач. Після стирання пацієнта (ст. 17 DSGVO) там лишалися б його ім'я й контакти, тож власник 2026-10-12 вирішив: історію задач пацієнта стирання теж очищує.

Виняток вузький (міграція `20261012160000_dsgvo_erasure_task_event_scrub.sql`):

- діє лише всередині транзакції стирання: `anonymize_patient_record` вмикає транзакційне налаштування `set_config('gmed.dsgvo_erasure', 'on', true)` тільки на час одного `UPDATE` і одразу вимикає; після коміту чи відкату налаштування зникає саме;
- дозволено лише `UPDATE`; `DELETE` заборонено завжди;
- змінюватися можуть лише текстові значення payload (функція `gmed_jsonb_only_text_changed`): ті самі ключі, та сама структура й довжина масивів, ті самі числа, прапорці й `null`; жодна інша колонка (`event_type`, `actor_id`, `created_at`, …) не змінюється;
- заміна та сама, що й у тексті задач: ім'я, прізвище, повне ім'я, номер пацієнта, e-mail, телефони, документи, контакт для екстрених випадків → мітка `ANON-…` (`gmed_scrub_jsonb_text`); змінений текст під ключем, що дзеркалить колонку з обмеженням (`body`/`previous_body` 4000, `label`/`previous_label` 500, `file_name` 255), обрізається до неї;
- саме стирання записується в `audit_log` (`dsgvo_anonymize`, лічильник `scrubbed_free_text.task_events`), тож факт зміни історії задокументовано в незмінному журналі.

`audit_log` під цей виняток не підпадає: туди персональних даних пацієнта не кладуть (див. «Випадок 3»). Тест: `task_history_stays_append_only_except_for_text_in_the_erasure` (`crates/server/tests/admin_compliance_api.rs`) — звичайне оновлення відхиляється, у стиранні — лише зміна тексту.

## Як перевірити покриття зараз

```bash
# Скільки ручних INSERT-ів залишилось
git grep -c -F "INSERT INTO audit_log" -- crates/server/src/routes/ | awk -F: '{s+=$2} END {print s}'

# Має дорівнювати AUDIT_INSERT_BUDGET в scripts/check_repo_hygiene.py
python scripts/check_repo_hygiene.py

# Скільки рядків audit_log у БД (живий стан)
psql "$DATABASE_URL" -c "SELECT action, count(*) FROM audit_log GROUP BY action ORDER BY 2 DESC LIMIT 20;"
```

## Посилання

- Модуль: [`crates/server/src/audit.rs`](../../crates/server/src/audit.rs)
- Schema: [`migrations/20260407000001_initial_schema.sql`](../../migrations/20260407000001_initial_schema.sql) (`audit_log` table + `audit_log_immutable` trigger)
- Ratchet: [`scripts/check_repo_hygiene.py`](../../scripts/check_repo_hygiene.py) (`AUDIT_INSERT_BUDGET`)
- ISO 27001 A.8.15 / BSI C5 OPS-15 — нормативна основа цих вимог
