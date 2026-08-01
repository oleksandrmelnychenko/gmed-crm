# Стратегія об'єднання клінічної моделі: пацієнт = джерело правди, кейс = епізод (RFC)

**Статус документа:** ухвалений дизайн (рішення зафіксовані в цьому документі, розд. 9)
**Автор:** Claude (за запитом Olek)
**Зона впливу:** `crates/server/src/routes/{cases,leads,patients,orders,drug_products,admin_compliance,e2e_support}.rs`, `crates/server/src/services/drug_matching.rs`, `crates/server/src/main.rs`, `migrations/`, `frontend/src/pages/{case-workspace,cases,leads,patients}/*`, i18n
**Пов'язані документи:** [`clinical-redesign-plan.md`](clinical-redesign-plan.md) (пацієнтський клінічний майстер, фази 1–5 shipped), [`lead-status-strategy-ua.md`](lead-status-strategy-ua.md) (state-machine ліда, реалізовано), [`engineering/03_lead-retention-policy_ua.md`](engineering/03_lead-retention-policy_ua.md) (ретенція лідів)

---

## 1. Як є зараз

У системі існують **дві паралельні клінічні моделі**, що зберігають одні й ті самі факти:

| Факт | Кейсовий рівень (квітень, `20260408000006_medical_case.sql`) | Пацієнтський рівень (червень, `20260604100000_patient_clinical_master.sql`) |
|---|---|---|
| Анамнез | `cases.aktuelle_anamnese`, `cases.hauptanfragegrund` (плоскі TEXT) | `patient_clinical_narrative` — версіонований, 5 полів, одна активна версія |
| Діагнози | `vorerkrankungen` (erkrankung + рік + нотатка) | `patient_diagnoses` — дерево, ICD-10/OPS, certainty, хроніфікація, атрибуція лікаря |
| Медикаменти | `medikamente` (фрітекст-доза, med_typ permanent/temporary) | `patient_medications` — BMP-модель: 4 слоти доз, категорії dauer/besondere/selbst, status, hold, BtM, Aut-idem |
| Алергії | `allergien` (allergie + reaktion) | `patient_clinical_warnings` (kind=allergie/cave, severity) |
| Операції | `operationen` | `patient_procedures` (label, OPS, дата) |
| Вегетативний анамнез | `vegetative_anamnese` (1:1, зріст/вага/апетит) | `patient_clinical_narrative.anamnese_vegetative` + `patient_vital_measurements` |
| Impfstatus | `impfstatus` (1:1, фрітекст) | — (відсутній) |

Дубль **матеріалізується при конвертації ліда**: `transfer_lead_clinical_profile` (`leads.rs:2644-3081`) копіює кейсові дані в пацієнтські таблиці; кейсові рядки лишаються редагованими. Далі два дерева живуть незалежно, редагуються двома різними UI (`/cases/:caseId` воркспейс і таб «Diagnosen & Medikation» картки пацієнта) — **синхронізації немає в жоден бік**.

Причина існування кейсового дерева — історична: клінічним даним був потрібен дім **до** існування пацієнта. Звідси поліморфний суб'єкт `cases.patient_id XOR lead_id` (`20260710170000_lead_onboarding_subjects.sql`) і копіювання при конвертації.

Супутні факти:

- `cases.status` — мертве поле: жоден код не пише нічого, крім дефолтного `'open'`. Роуту зміни статусу не існує. Кейси не закриваються ніколи.
- UI кейса задубльований: воркспейс `/cases/:caseId` (15 секцій) **і** інлайн-редактор у детейл-шиті ростера `/cases` (`pages/cases/page.tsx:2724-4427`) — з розбіжністю (Impfstatus є лише в ростері).
- Ордер ↔ кейс: єдиний зв'язок — `cases.onboarding_order_id`, який пишеться один раз при конвертації (`leads.rs:4020-4029`). Оберненого зв'язку немає.
- Аудит асиметричний: кейс має `case_versions` (append-only, повна історія), пацієнтські клінічні POST-и — replace-all (`DELETE` + reinsert, напр. `patients.rs:8959`) **без історії** (виняток — версії анамнезу).
- Ретенція: `cases.retention_until` (30 років) живе на кейсі; на пацієнтському записі клінічного retention-годинника немає.
- `medication_drug_matches`, `medication_expiry_events`, роути німецьких еквівалентів (`drug_products.rs:40-47`) прив'язані до **кейсових** `medikamente`, а не до `patient_medications`.

## 2. Проблеми

1. **Розбіжність клінічної правди.** Після конвертації правки в кейсі не потрапляють у картку пацієнта і навпаки. Лікар бачить різні списки медикаментів залежно від того, куди зайшов.
2. **Подвійна вартість кожної фічі.** Drug matching, expiry-шедулер, еквіваленти зроблені для гіршої (кейсової) моделі медикаментів і не працюють для кращої (BMP).
3. **Кейс не має життєвого циклу** — неможливо відрізнити активне звернення від давно завершеного.
4. **Аудит губиться при русі до пацієнтського рівня**: якщо просто вимкнути кейсові секції, зникне єдиний append-only trail клінічних правок.
5. **Немає моделі повторного звернення**: пацієнт, що повертається, стає другим лідом → при конвертації створюється дублікат пацієнта. Дедуплікації немає.
6. **`intake_completed_at` скидається** кожним клінічним записом у кейс (`version_log`, `cases.rs:2709`) — гейт «інтейк завершено» ламається будь-якою пізнішою правкою.

## 3. Цільова модель: три шари

**Пацієнт** = ідентичність + клінічний запис (єдине джерело клінічної правди).
**Кейс** = епізод звернення: з чим прийшов, хто направив, епізодні опитники, життєвий цикл. Кейс дає клінічним фактам *контекст*, але не *володіє* ними.
**Ордер** = комерція (без змін по суті; додається чесний зв'язок з епізодом).

Кейс і ордер **не** зливаються: різні ролі (Billing бачить ордер, не клініку), різні терміни зберігання (клініка 30 р., фінанси 10 р. HGB), різні життєві цикли.

## 4. Ухвалені рішення

### D1 — Identity-first: пацієнт створюється на кроці «Медичні характеристики» візарда

Клінічні дані ніколи не існують без ідентифікованого пацієнта. Коли співробітник вперше зберігає медичний крок візарда (`persistMedicalDraft`, `lead-wizard.tsx:2682`), замість lazy-створення кейса з `lead_id` створюється:

1. **Пацієнт** зі статусом `lifecycle_status='prospective'` (див. D2) — через новий `POST /leads/{id}/prospect`;
2. **Кейс** з `patient_id` цього пацієнта (`lead_id` більше не потрібен для нових лідів).

**Гейт створення:** ім'я + дата народження + legal_sex обов'язкові (той самий набір, що сьогодні вимагає конвертація, `leads.rs:3533-3552`, — просто перевіряється раніше). Клінічний запис на неідентифіковану особу не ведеться; якщо master data незаповнена, візард повертає на відповідний крок.

**Що це усуває:**
- `transfer_lead_clinical_profile` (≈440 рядків) — конвертація перестає копіювати дані;
- поліморфний суб'єкт `patient_id XOR lead_id` на кейсі (після legacy-вікна);
- джерело дубля як таке: медичні форми візарда пишуть одразу в `/patients/{prospect_id}/...` (фронт уже наполовину готовий — `lead-medical-intake-form.tsx:122-143` вже реюзає `AnamneseSection` і `PatientMedicationSection` з картки пацієнта).

**Конвертація стає активацією:** `prospective → active` + консенти + комерційне перепідпорядкування (documents/contracts/orders — як зараз, `leads.rs:4015-4062`). Ідемпотентна, без руху клінічних даних.

**Зв'язок з лідом:** нова колонка `leads.prospect_patient_id UUID REFERENCES patients(id)`; при активації `converted_patient_id = prospect_patient_id` (усі наявні гарди на `converted_patient_id` лишаються валідними).

**Дедуплікація / повторне звернення:** перед створенням prospect бекенд шукає активного пацієнта з тим самим (нормалізоване ім'я + дата народження). Збіг → візард пропонує (роль PatientManager) «прив'язати до наявного пацієнта»: тоді prospect не створюється, кейс створюється на наявному пацієнті, лід отримує `prospect_patient_id` наявного пацієнта, а активація для вже-активного пацієнта зводиться до консентів + комерції. Це і є модель «пацієнт, що повертається» — новий епізод замість дубліката картки.

**Документи** лишаються на ліді до активації (як зараз, імпорт у `import_lead_attachments_internal`) — їхня ретенція вже покрита lead-політикою; переносити їх на prospect не потрібно.

### D2 — `patients.lifecycle_status` замість пари is_active-булів

За зразком ухваленої моделі ліда (єдиний lifecycle-статус, керовані переходи):

```
prospective ──▶ active ⇄ inactive
     │             └────▶ deleted   (DSGVO Art. 17, окремий flow)
     └─▶ (hard delete разом з лідом)   [prospect ніколи не «архівується»]
```

- Колонка `lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK IN ('prospective','active','inactive','deleted')`.
- Бекфіл: `is_active=true → 'active'`, `false → 'inactive'`. `is_active` на перехідний період пишеться синхронно (обидва поля в одному UPDATE), читачі переводяться поступово, потім колонка дропається (той самий патерн «не робимо рискових rename», що в lead-RFC).
- **Усі реєстри/дашборди/пошуки пацієнтів за замовчуванням показують лише `active`/`inactive`** (тобто поточну поведінку). `prospective` видимий тільки: зсередини візарда відповідного ліда; в явному фільтрі «Заявники» для PatientManager/CEO. Жодних prospect-ів у списках рахунків, термінів, розсилок.
- `activate`/`deactivate` роути (`patients.rs:7883,7928`) стають переходами `active ⇄ inactive` з валідацією.

**PID.** `patient_id` (`P-YYYYMMDD-NNNN`) присвоюється **одразу при створенні prospect** з того ж `patient_id_seq`. Обґрунтування: ідентифікатор ідентифікує *запис*, а не комерційний успіх; клінічні дані з першого дня потребують стабільного посилання (аудит, документи, дедуплікація); колонка лишається `NOT NULL UNIQUE` без релаксації схеми, яку б зачепили десятки місць UI. «Дірки» в нумерації від несконвертованих заявників — прийнятні й нічого не означають (це вже так для лідів).

### D3 — GDPR для prospective: доля прив'язана до ліда

Prospect без активації не має самостійної підстави зберігання — його ретенція успадковує lead-політику (`cleanup_archived_leads_days`, 180 дн., sweeper `auto_purge_stale_archived`):

- Лід `archived`/`not_qualified` → prospect **лишається** (sales може реанімувати лід — «Вернуть в работу»).
- Лід переходить у `deleted` (ручне видалення або sweeper) → у тій самій транзакції prospect з `lifecycle_status='prospective'` **hard-delete** (`DELETE FROM patients` — CASCADE зносить кейс і всі клінічні таблиці). Не анонімізація: у несконвертованої особи немає підстави тримати навіть знеособлену клінічну структуру. Аудит-подія `purge_prospect_patient` з `gdpr_article: 5(1)(e)` — за зразком `auto_purge_lead`.
- Пацієнта зі статусом `active` sweeper **не торкається ніколи** (ретенція пацієнта — окремий DSGVO-flow в `admin_compliance.rs`, як і зараз).
- `anonymize_lead_pii` розширюється цим кроком — ручний і автоматичний шляхи лишаються одним кодом (інваріант з retention-policy док.).

### D4 — Кейс = епізод: склад і життєвий цикл

**Лишається на кейсі** (епізодне, дублікатів не має):
`case_id` (C-номер), `hauptanfragegrund`, `zuweiser` + `zuweiser_doctor_id`, `manager_id`, `intake_completed_at/by`, `pain_records`, `symptome`, шість `case_*_assessments` (епізодні опитники з red flags), `case_versions` (аудит епізодних полів), `notes`.

**Вмирає на кейсі** (переїжджає до пацієнта):

| Кейсова таблиця/поле | Доля |
|---|---|
| `medikamente` | → `patient_medications` (уже є; історія — розд. 6) |
| `allergien` | → `patient_clinical_warnings` (kind=allergie) |
| `vorerkrankungen` | → `patient_diagnoses` |
| `operationen` | → `patient_procedures` |
| `cases.aktuelle_anamnese` | → версія `patient_clinical_narrative` з атрибуцією до епізоду (D5) |
| `vegetative_anamnese` | зріст/вага → `patient_vital_measurements` (measured_at = дата інтейку); текстові поля → `anamnese_vegetative` активної версії наративу |
| `impfstatus` | → нова 1:1 таблиця `patient_impfstatus(patient_id PK, status_text, updated_at)`; секція в клінічному табі пацієнта. Структурований список щеплень — свідомо поза скоупом (розд. 8) |

**Життєвий цикл** — наявні CHECK-значення `open / in_progress / closed` нарешті отримують state-machine (нові значення не потрібні):

```
open ─▶ in_progress ─▶ closed(reason)
  │          ▲______________│   (reopen, з аудитом)
  └────────▶ closed(reason)
```

| З | У | Тригер |
|---|---|---|
| `open` | `in_progress` | авто: завершення інтейку або перехід пов'язаного ордера у фазу `execution`; або вручну |
| `open`/`in_progress` | `closed` | вручну, `closed_reason` обов'язковий: `abgeschlossen` / `abgebrochen` / `dublette` |
| `closed` | `in_progress` | «Wieder öffnen» (аудит-подія) |

Нові колонки: `closed_reason TEXT`, `closed_at`, `status_changed_at` (патерн «днів у статусі» з lead-RFC). Новий роут `POST /cases/{id}/status` з `ALLOWED_TRANSITIONS` → недозволений перехід = `409`. Автозакриття не робимо — при завершенні ордера UI *пропонує* закрити кейс.

**Фікс побічного бага:** `version_log` перестає скидати `intake_completed_at` (`cases.rs:2709`) — після D6 клінічних записів у кейс більше немає, а епізодні правки (біль/симптоми/опитники) не мають анулювати факт завершеного інтейку.

### D5 — Епізодна атрибуція замість копій

Нульова копія; замість неї — контекст. Нова nullable-колонка `case_id UUID REFERENCES cases(id) ON DELETE SET NULL` додається до:

- `patient_diagnoses` (в якому епізоді встановлено),
- `patient_examinations`,
- `patient_procedures`,
- `patient_clinical_verlauf`,
- `patient_clinical_narrative` (версія анамнезу, знята в межах епізоду).

**Свідомо БЕЗ атрибуції:** `patient_medications`, `patient_clinical_warnings`, `patient_impfstatus`, vitals, risk scores — це *стан пацієнта*, а не подія звернення (BMP — живий план, алергія не «належить» кейсу).

`ON DELETE SET NULL` — видалення епізоду ніколи не видаляє клінічні факти.

**Проєкції:**
- Воркспейс кейса: секції «Diagnosen», «Befunde», «Therapie», «Verlauf», «Anamnese» показують пацієнтські дані з фільтром «цей епізод» (дефолт) / «уся акта»; запис іде в пацієнтські ендпоінти з проставленим `case_id`. Секції «Medikamente», «Allergien» показують повний стан пацієнта (він один) з міткою «Patientenakte».
- Клінічний таб пацієнта: на атрибутованих рядках — бейдж епізоду (C-номер, клікабельний у воркспейс), опційний фільтр по епізоду.

Пацієнтські replace-all ендпоінти приймають `case_id` як поле елемента (nullable, персистується as-is).

### D6 — Паритет аудиту й ретенції ДО перенесення джерела правди

Без цього рухати SoT не можна:

- **`patient_clinical_versions`** — append-only, дзеркало `case_versions`: `(id, patient_id, case_id NULL, section, old_value JSONB, new_value JSONB, changed_by, created_at)` + immutable-тригер (за audit-policy док.). Вшивається в **усі** клінічні POST-и `patients.rs` (diagnoses, medications, examinations, narrative, verlauf, procedures, clinical-warnings, impfstatus): у транзакції зберігання — знімок old/new. Історія «хто і що змінив» перестає жити тільки на кейсі.
- **`patients.clinical_retention_until`** — 30-річний годинник (той самий `clinical_case_retention_years`), продовжується кожним клінічним записом. `cases.retention_until` лишається для епізодних даних, але головний clock — на записі пацієнта.
- `patients.last_clinical_update_at` — денормалізація для дашбордів (паритет з кейсовим полем).

### D7 — Drug matching, еквіваленти, expiry — на `patient_medications`

- `medication_drug_matches`: нова колонка `patient_medication_id` (FK), запис іде на неї; `medication_id` (кейсова) лишається до розд. 6-міграції, потім дропається.
- Роути переїжджають: `/cases/{id}/medikamente/{mid}/equivalents|drug-matches[...]` → `/patients/{id}/medications/{mid}/equivalents|drug-matches[...]` (`drug_products.rs`, `services/drug_matching.rs` — пошук по `wirkstoff`/`handelsname` працює як є, бо `patient_medications` має обидва поля).
- `medication_expiry_events`: джерело — `patient_medications.einnahme_bis` (це і є expiry в BMP-моделі); шедулер `spawn_medication_expiry_scheduler` (`cases.rs:3455`, `main.rs:56`) переписується на пацієнтські рядки, `case_id` у події замінюється на `patient_medication_id`.
- Панель «Deutsche Äquivalente» (`medication-equivalents-panel.tsx`) переносится у секцію «Medikation» клінічного таба пацієнта і воркспейс-проєкцію — одна імплементація.

### D8 — `orders.case_id`: чесний шов комерції та епізоду

- `ALTER TABLE orders ADD COLUMN case_id UUID REFERENCES cases(id) ON DELETE SET NULL` + індекс.
- Бекфіл: `UPDATE orders o SET case_id = c.id FROM cases c WHERE c.onboarding_order_id = o.id`.
- Візард проставляє `case_id` при створенні ордера; суб-ордери (`head_order_id`) успадковують `case_id` головного.
- `cases.onboarding_order_id` дропається в останній фазі (односторонній вказівник був милицею).
- «Пов'язані кейси» у термінах (`use-appointment-linked-records.ts`) і ордер-воркспейсі читають прямий FK замість здогадок по пацієнту.

### D9 — Один UI кейса

- Ростер `/cases` лишається списком + створенням; **інлайн-редактор клінічних секцій у детейл-шиті (`pages/cases/page.tsx:2724-4427`) видаляється повністю**, клік по рядку → воркспейс.
- Воркспейс `/cases/:caseId` — єдине місце роботи з епізодом: епізодні секції (біль, симптоми, опитники) як є; клінічні секції — проєкції з D5; Impfstatus зникає з кейса (переїхав до пацієнта, D4).
- Лід-візард: медичний крок пише в `/patients/{prospect}/...`; `wizard_state.clinical_draft` перестає бути сховищем (лишається лише UI-прогрес візарда).

## 5. Legacy-вікно: ліди в польоті

Дискримінатор: `leads.intake_model TEXT NOT NULL DEFAULT 'patient_first' CHECK IN ('legacy','patient_first')`; бекфіл наявних рядків → `'legacy'`.

- `legacy`-ліди: конвертація йде старим шляхом (`transfer_lead_clinical_profile` + re-parenting) — код лишається до фази 6.
- `patient_first`-ліди: prospect-flow з D1.
- Нетермінальні `legacy`-ліди з клінічними чернетками добиваються природно (конвертуються/архівуються за тижні); залишок перед фазою 6 конвертується вручну або міграційним скриптом. Після нуля legacy у нетермінальних станах — transfer-код видаляється.

## 6. Історичні дані: реконсиліація, не сліпий дроп

Кейсові копії редаговані досі — з моменту конвертації обидва дерева могли розійтися **в обидва боки**. Процедура:

1. **Звіт** (одноразовий read-only SQL / admin-ендпоінт): для кожного сконвертованого пацієнта — diff нормалізованих кейсових рядків проти пацієнтських. Класи:
   - `identical` — кейсова копія підтверджено зайва;
   - `patient_newer` — пацієнт виграє (він — живий запис), кейсова копія застаріла;
   - `case_newer` — кейсові правки *після* конвертації (порівняння `case_versions`-штампів з датою конвертації) — **ручний список на злиття**, бо це чиїсь реальні правки, які інакше мовчки загубляться.
2. Злиття `case_newer`-випадків руками (очікувано одиниці — кейсовий UI після конвертації відкривають рідко).
3. **Знімок**: `cases.intake_snapshot JSONB` = `{vorerkrankungen, allergien, medikamente, operationen, vegetative, impfstatus, hauptanfragegrund, aktuelle_anamnese, frozen_at}` — юридично корисний артефакт «Stand bei Aufnahme», потрапляє в DSGVO-експорт (`admin_compliance.rs:173`).
4. Дроп кейсових клінічних таблиць + кейсових клінічних POST-роутів (повертають `410 Gone` одну версію, потім зникають).

Демо-сид (`20260417143000_refresh_demo_seed_data.sql`) і e2e-фікстури (`e2e_support.rs:1026`) оновлюються в цій же фазі.

## 7. Порядок впровадження

Конвенція як у `clinical-redesign-plan.md`: фаза = міграція (forward-only, idempotent, **застосовує Olek**) + бекенд + фронт + коміт. Кожна фаза shippable, big-bang немає.

### Фаза 0 — заморозка (без коду)
- ☐ Правило в PR-чекліст: жодних нових фіч на кейсових клінічних таблицях (`medikamente`, `allergien`, `vorerkrankungen`, `operationen`, `vegetative_anamnese`, `impfstatus`).

### Фаза 1 — паритет аудиту й ретенції (D6)
- ☐ Міграція: `patient_clinical_versions` (+immutable trigger), `patients.clinical_retention_until`, `patients.last_clinical_update_at`.
- ☐ `patients.rs`: version-log у всіх клінічних POST-ах; продовження retention-годинника.
- ☐ Бекфіл `clinical_retention_until` з `cases.retention_until` по пацієнту (max).

### Фаза 2 — гігієна кейса (D4-lifecycle, D9-частково)
- ☐ Міграція: `cases.closed_reason`, `closed_at`, `status_changed_at`.
- ☐ `cases.rs`: `ALLOWED_TRANSITIONS`, `POST /cases/{id}/status`, стоп скидання `intake_completed_at` у `version_log`.
- ☐ Фронт: статус-дії у воркспейсі; видалення інлайн-редактора з `pages/cases/page.tsx`; пропозиція закриття кейса при завершенні ордера.
- ☐ i18n: `case_status_*`, причини закриття.

### Фаза 3 — identity-first (D1, D2, D3)
- ☐ Міграція: `patients.lifecycle_status` (+бекфіл з `is_active`), `leads.prospect_patient_id`, `leads.intake_model` (+бекфіл `'legacy'`).
- ☐ `leads.rs`: `POST /leads/{id}/prospect` (гейт master data, дедуп-перевірка, PID, кейс на `patient_id`); активація замість копіювання для `patient_first`; `anonymize_lead_pii` + hard-delete prospect; sweeper-тести.
- ☐ `patients.rs`: фільтри `lifecycle_status` у списках/пошуку; переходи `active ⇄ inactive`.
- ☐ Візард: медичний крок → пацієнтські ендпоінти; UI прив'язки до наявного пацієнта при збігу.
- ☐ E2E: prospect-flow, purge-flow, дедуп-flow.

### Фаза 4 — епізодна атрибуція і проєкції (D5)
- ☐ Міграція: `case_id` на 5 пацієнтських таблицях.
- ☐ `patients.rs`: приймання/віддача `case_id` у клінічних контрактах.
- ☐ Воркспейс кейса: клінічні секції → проєкції пацієнтських даних (фільтр епізода); кейсові клінічні POST-и більше не викликаються фронтом.
- ☐ Клінічний таб пацієнта: бейджі епізодів, фільтр.
- ☐ Impfstatus: таблиця `patient_impfstatus`, секція в табі пацієнта, зникнення з кейса.

### Фаза 5 — фармакологія на пацієнті (D7)
- ☐ Міграція: `medication_drug_matches.patient_medication_id`, `medication_expiry_events.patient_medication_id`.
- ☐ Роути еквівалентів/матчів під `/patients/...`; шедулер на `patient_medications.einnahme_bis`.
- ☐ Панель еквівалентів у табі пацієнта + проєкції.

### Фаза 6 — реконсиліація і демонтаж (розд. 5, 6)
- ☐ Звіт-діфф, ручне злиття `case_newer`.
- ☐ Міграція: `cases.intake_snapshot` (бекфіл із кейсових таблиць), дроп кейсових клінічних таблиць, дроп `cases.lead_id` + XOR-констрейнта, дроп legacy-колонок drug-matches/expiry.
- ☐ Видалення `transfer_lead_clinical_profile`, кейсових клінічних POST-ів (через `410`), мертвого коду `clinical_draft`.
- ☐ DSGVO-експорт: `intake_snapshot` + атрибутовані дані. Демо-сид, e2e-фікстури.

### Фаза 7 — комерційний шов (D8)
- ☐ Міграція: `orders.case_id` (+бекфіл), пізніше дроп `cases.onboarding_order_id`.
- ☐ Візард/ордери: проставлення `case_id`; пов'язані записи через прямий FK.

Найризиковіша фаза — 3 (реєстри, конвертація, GDPR-шляхи); найтрудомісткіша — 4 (воркспейс кейса). Фази 1–2 незалежні й дають цінність самі по собі; 4 залежить від 3 (проєкція потребує існування пацієнта в лід-фазі); 6 — від 4 і 5; 7 незалежна від 4–6, може йти паралельно.

## 8. Що свідомо НЕ робимо

- **Структурований список щеплень** (`patient_vaccinations`) — Impfstatus переїжджає як фрітекст 1:1; структура — окрема продуктова тема.
- **Повний FHIR-ресурсинг** (Encounter/Observation/MedicationStatement як окремі ресурси) — беремо лише принцип «факти в пацієнта, контекст в епізоді»; власні таблиці лишаються.
- **Кейс-скоуп для workflow-чеклістів** — чеклісти лишаються на `patient`/`order`; епізодний прогрес несуть статуси кейса.
- **Автозакриття кейсів** — лише пропозиція в UI при завершенні ордера.
- **Злиття кейса з ордером** — розд. 3.
- **Міграцію ретенції фінансів/документів** — поза скоупом (є власні політики).

## 9. Ухвалені рішення (зведення)

| # | Рішення |
|---|---|
| D1 | Prospect-пацієнт створюється на медичному кроці візарда; конвертація = активація без копіювання; дедуп «прив'язати до наявного» |
| D2 | `patients.lifecycle_status` (`prospective/active/inactive/deleted`), PID присвоюється одразу, реєстри дефолтно ховають prospective |
| D3 | Доля prospect прив'язана до ліда: лід `deleted` → hard-delete prospect (CASCADE), аудит-подія; активних не торкаємось |
| D4 | Кейс = епізод: лишаються привід/зівайзер/біль/симптоми/опитники; клінічні таблиці кейса вмирають; state-machine `open→in_progress→closed(reason)`; `intake_completed_at` більше не скидається правками |
| D5 | Епізодна атрибуція `case_id` на diagnoses/examinations/procedures/verlauf/narrative; медикаменти/алергії/impfstatus — стан пацієнта, без атрибуції; воркспейс = проєкція |
| D6 | Перед перенесенням SoT: `patient_clinical_versions` (append-only) + `clinical_retention_until` на пацієнті |
| D7 | Drug matching / еквіваленти / expiry — на `patient_medications`; роути під `/patients` |
| D8 | `orders.case_id` (FK), бекфіл з `onboarding_order_id`, потім дроп милиці |
| D9 | Один UI кейса: воркспейс; інлайн-редактор ростера видаляється; Impfstatus → пацієнт |

---

**Наступний крок:** Фаза 1 (міграція `patient_clinical_versions` + retention-колонки; бекенд version-log) — незалежна, безризикова, розблоковує все інше.
