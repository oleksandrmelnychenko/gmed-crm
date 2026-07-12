# Стратегія статусів ліда (RFC)

**Статус документа:** чернетка на узгодження
**Автор:** Claude (за запитом Olek)
**Зона впливу:** `crates/server/src/routes/leads.rs`, `migrations/`, `frontend/src/pages/leads/*`, i18n
**Мета:** зробити модель статусів ліда логічною, з єдиним джерелом правди та керованим state-machine замість чотирьох паралельних полів, що частково дублюють одне одного.

---

## 1. Як є зараз

Лід має **чотири паралельні статусні поля** замість одного життєвого циклу:

| Поле | Значення | Хто змінює |
|---|---|---|
| **`qualification_status`** (головний) | `new`, `in_progress`, `qualified`, `not_qualified`, `converted`, `archived` | `create_lead`; `POST /leads/{id}/qualify`; `convert_lead`; `resolve_failed_lead` |
| `compliance_status` | `pending`, `documents_sent`, `signed`, `rejected` | лише `POST /leads/{id}/update` |
| `failed_outcome_status` | `none`, `archived`, `delete_anonymized` | `resolve_failed_lead`, retention-sweeper |
| `converted_patient_id` | NULL / UUID | `convert_lead` (де-факто прапор «конвертований») |

Гейти переходів рахує `evaluate_lead_conversion_readiness()` (`leads.rs:477`): `qualification_ready` і `conversion_ready` на основі заповненості master data, документів (`documents`), інтейку (`cases.intake_completed_at`), договору (`framework_contracts`), ордера/послуг/підписів/квоти/передоплати (`orders`, `order_leistungen`, `quotes`). Кожна зміна пише подію в `workflow_lifecycle_events`.

### Життєвий цикл де-факто

```
new ─▶ (робота у візарді) ─▶ qualified ─▶ converted        (успіх)
                                  └─▶ archived / deleted     (провал)
```

## 2. Проблеми

1. **Подвійне кодування.**
   - Провал: одночасно `qualification_status='archived'` **і** `failed_outcome_status='archived'` (`leads.rs:3197-3198`).
   - Видалення: `qualification_status='archived'`, але `failed_outcome_status='delete_anonymized'` (`leads.rs:3958-3959`) — «видалений» лід читається як `archived`, і лише `current_lead_stage()` (`leads.rs:417`) перемаплює його на `"deleted"`.
   - Конвертація: і рядок `'converted'`, і `converted_patient_id`; але всі гарди перевіряють лише id (`leads.rs:2689,2743,3165,1808`), рядок майже декоративний.

2. **Мертві стани.** `in_progress` і `not_qualified` є в CHECK, мають кольори/лейбли, приймаються `qualify_lead` — але **жоден екран їх не ставить** (UI шле лише `"qualified"`: `page.tsx:1640`, `lead-wizard.tsx:2020`). `in_progress` — найлогічніший стан під час обробки, а він порожній: лід весь час «новий».

3. **Немає state-machine.** `new`/`in_progress`/`not_qualified` ставляться вільно, без гарда (`leads.rs:1824` гейтить лише ціль `qualified`). `compliance_status` без правил зовсім; `documents_sent`/`rejected` ніде не читаються — лише колір.

4. **`failed_outcome` не скидається.** Немає переходу назад у `none`; `archived` — фактично термінал (крім retention-видалення).

5. **Дрібніші.** Лейбли кроків `readiness` захардкоджені німецькою на бекенді (`leads.rs:754-759`), тоді як усі інші — i18n. Логіка `lead_type` продубльована в Rust (`leads.rs:358`) і TS (`leads-model.ts:590-650`) з різними списками джерел.

## 3. Пропонована модель

**Один головний статус = джерело правди. Керований state-machine з гардами. Решта полів — метадані/під-треки, не паралельні статуси.**

### 3.1 Значення головного статусу (`lifecycle_status`)

Лишаємо колонку `qualification_status` (щоб не робити рискової rename-міграції), але трактуємо її як єдиний **lifecycle-статус**. Набір значень:

| Значення | ru | de | Тон | Сенс |
|---|---|---|---|---|
| `new` | Новый | Neu | info (sky) | Щойно надійшов, ще не відкривали |
| `in_progress` | В работе | In Bearbeitung | warning (amber) | Відкрито у візарді, йде обробка |
| `qualified` | Квалифицирован | Qualifiziert | success (emerald) | Пройдено гейт кваліфікації |
| `converted` | Пациент создан | Patient angelegt | brand (violet) | Створено пацієнта — **термінал-успіх** |
| `not_qualified` | Не подходит | Nicht geeignet | error (rose) | Свідомо відхилено (з причиною) |
| `archived` | В архиве | Archiviert | neutral (slate) | Закрито без конвертації |
| `deleted` | Удалён | Gelöscht | neutral (slate) | Анонімізовано (retention/GDPR) — **термінал** |

Зміни проти поточного: `converted` перейменовуємо в UI на «Пациент создан» (логічніше); додаємо `deleted` як явне значення (замість «archived + failed_outcome»).

### 3.2 State-machine (дозволені переходи)

```
              ┌──────────────── forward ────────────────┐
   new ─▶ in_progress ─▶ qualified ─▶ converted   [термінал ✓]
    │          │            │
    ├──────────┼────────────┴─▶ not_qualified     [відновлюваний]
    └──────────┴──────────────▶ archived ─▶ deleted [термінал]
```

| З | У | Гард | Тригер |
|---|---|---|---|
| `new` | `in_progress` | — | **авто при відкритті візарда** співробітником |
| `new`/`in_progress` | `qualified` | `readiness.qualification_ready` | кнопка «Квалифицировать» або авто після інтейку |
| `qualified` | `converted` | `readiness.conversion_ready` + роль PatientManager | кнопка «Создать пациента» |
| `new`/`in_progress`/`qualified` | `not_qualified` | причина обов'язкова | кнопка «Не подходит» |
| `new`/`in_progress`/`qualified`/`not_qualified` | `archived` | — | кнопка «В архив» |
| `not_qualified` | `in_progress` | — | «Вернуть в работу» (реактивація) |
| `archived` | `in_progress` | — | «Восстановить» |
| `archived` | `deleted` | роль PatientManager/CEO | retention-sweeper або ручне видалення |
| `converted`, `deleted` | — | **термінали** (переходів немає) |

**Ключове:** ці переходи **валідуються на бекенді** мапою `ALLOWED_TRANSITIONS`, а не вільним `UPDATE ... SET status`. Спроба недозволеного переходу → `409 Conflict` з поясненням.

### 3.3 Що робимо з рештою полів

- **`converted_patient_id`** — лишається як FK на пацієнта (дані про зв'язок), але **перестає бути статусом**: єдине джерело істини «конвертований» = `lifecycle_status='converted'`. Гарди переписуємо на статус.
- **`failed_outcome_*`** — колонки `failed_reason`, `failed_note`, `failed_from_status`, `failed_processed_at/by` лишаються як **метадані причини** (чому відхилили/заархівували). Поле-статус `failed_outcome_status` **депрекуємо**: `archived`/`deleted` тепер несе головний статус.
- **`compliance_status`** — **не головний статус**, а окремий під-трек «документи». Робимо його теж керованим: `pending → documents_sent → signed`, `rejected` як бічний. `documents_sent` реально ставимо при завантаженні документів (зараз воно мертве). Читається `readiness`.
- **`wizard_state`** — лишається як прогрес-маркер візарда (не статус).

### 3.4 «Днів у статусі» (час у поточному стані)

Треба бачити, **скільки днів лід перебуває в поточному статусі** — щоб ловити «застряглих» (напр. `in_progress` 14 днів = хтось забув).

- Додаємо колонку **`status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()`** на `leads`, яку **оновлюємо на кожному переході** статусу (в тому ж місці, де пишемо lifecycle-подію). При створенні = `now()`.
- «Днів у статусі» = `now() - status_changed_at` (рахуємо у днях, округлення вниз). Бекенд віддає `status_changed_at` в деталі ліда та в списку; фронт рахує/показує.
- **UI:** біля пілюлі статусу — маленький сірий підпис `· 3 дн` (або в тултипі пілюлі). У списку лідів — окрема колонка/сортування «Днів у статусі» для виявлення застряглих.
- Джерело істини лишається `workflow_lifecycle_events` (повна історія переходів); `status_changed_at` — це денормалізований кеш «коли востаннє змінився статус» для швидкого читання/сортування без агрегації подій.
- Опційно (пізніше): поріг «застрягання» на статус (напр. `in_progress > 7 дн` підсвічувати бурштиновим) — але це вже після базового відображення.

## 4. План впровадження (маленькими комітами)

### Крок 1 — БД (міграція, forward-only, idempotent)
- `ALTER TABLE leads DROP CONSTRAINT ... ; ADD CONSTRAINT qualification_status CHECK IN (..., 'deleted')` — додати `deleted`.
- `ALTER TABLE leads ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now()` — для «днів у статусі» (розд. 3.4). Бекфіл: для наявних рядків = `created_at` (або час останньої lifecycle-події статусу, якщо є).
- **Data-migration:** рядки з `failed_outcome_status='delete_anonymized'` → `qualification_status='deleted'`; лишити `failed_reason`/дати як є.
- `failed_outcome_status` поки лишаємо (не дропаємо колонку в цьому кроці) — читаємо тільки для сумісності, писати перестаємо.

### Крок 2 — Rust: state-machine
- Ввести `enum LifecycleStatus` + `fn allowed_transitions(from) -> &[LifecycleStatus]` + `fn validate_transition(from, to) -> Result<(), 409>`.
- `qualify_lead`, `convert_lead`, `resolve_failed_lead` пропускають через валідатор; прибрати вільний set.
- **Кожен перехід статусу оновлює `status_changed_at = now()`** (в тому ж місці, де пишеться lifecycle-подія). Віддавати `status_changed_at` у деталі та списку лідів.
- **Ендпоінт переходу для `in_progress`:** статус `new → in_progress` ставиться, коли співробітник **відкрив візард** (тригерить фронт, розд. 3.2). Бекенд валідує перехід і стемпить `status_changed_at`.
- Переписати гарди з `converted_patient_id IS NOT NULL` на `status = 'converted'` (лишивши id як допоміжну перевірку цілісності).
- Винести лейбли кроків `readiness` у ключі i18n (прибрати німецькі рядки з Rust).

### Крок 3 — Frontend
- **При відкритті візарда** для ліда зі статусом `new` — викликати перехід у `in_progress` (розд. 3.2).
- Додати кнопки дій станів: «Не подходит» (з причиною), «В архив», «Восстановить/Вернуть в работу».
- Показувати `in_progress` («В работе») коректно; оновити лейбл `converted` → «Пациент создан».
- **«Днів у статусі»** (розд. 3.4): біля пілюлі статусу підпис `· N дн`; у списку лідів — колонка/сортування.
- Показувати дозволені дії згідно поточного статусу (ховати недозволені переходи).
- Прибрати дубль-логіку `lead_type`: єдине джерело — бекенд-поле, TS лише мапить лейбл/тон.

### Крок 4 — i18n
- Оновити/додати ключі `lead_status_*` (нове `deleted`, змінений `converted`), `lead_compliance_*`, ключі кроків readiness.

### Крок 5 — (пізніше, окремо) прибирання
- Після стабілізації — дропнути колонку `failed_outcome_status` і залишкові згадки.

## 5. Data-migration: старе → нове

| Було | Стане |
|---|---|
| `qualification_status='converted'` | без змін |
| `archived` + `failed_outcome='archived'` | `archived` (failed_reason лишається метаданими) |
| `archived` + `failed_outcome='delete_anonymized'` | `deleted` |
| `new`/`in_progress`/`qualified`/`not_qualified` | без змін |

## Рішення (узгоджено)

- ✅ `converted` в UI = **«Пациент создан»**.
- ✅ `in_progress` ставиться **при відкритті візарда** співробітником.
- ✅ Додаємо **«днів у статусі»** (`status_changed_at`, розд. 3.4).

## 6. Рішення по відкритих питаннях

- ✅ Реактивація `not_qualified`/`archived` → повертаємо в **`in_progress`**.
- ✅ `compliance_status` — **повноцінний під-трек у цьому ж заході** (`pending → documents_sent → signed`, `rejected` бічний; `documents_sent` реально ставимо при завантаженні документів).
- ✅ Окремий термінал `lost` **не потрібен** — обходимось `not_qualified` + `archived`.
- ✅ Колонку `qualification_status` **не перейменовуємо** — лишаємо назву як єдиний lifecycle-статус.

---

**Наступний крок:** усі рішення узгоджено. Старт: Крок 1 (міграція `status_changed_at` + `deleted`) → Крок 2 (Rust state-machine + compliance-під-трек) → Крок 3 (фронт).
