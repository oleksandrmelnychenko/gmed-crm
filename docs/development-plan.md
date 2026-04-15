# Development Plan: gmed-crm

> Конкретний план розробки медичної CRM/ERP системи.
> Стек: Rust + Leptos (WASM) + PostgreSQL + AWS (eu-central-1).

---

## 1. Огляд

### Підхід
- **Modular monolith** — один Rust-проєкт з чіткими модулями
- **2-тижневі спрінти** (10 робочих днів)
- **Інкрементальні релізи** — кожен реліз дає робочу систему з більшим функціоналом
- **1 розробник** (full-stack Rust + infra)

### Загальний таймлайн

| Релiз | Назва | Спрінти | Тижні | Що дає |
|-------|-------|---------|-------|--------|
| R0 | Foundation | S1–S3 | 6 тижнів | Інфра, auth, RBAC, audit, БД-схема |
| R1 | Intake & Case | S4–S7 | 8 тижнів | Пацієнти, анамнез, ліди, замовлення |
| R2 | Operations | S8–S11 | 8 тижнів | Терміни, провайдери, документи, перекладачі |
| R3 | Finance | S12–S14 | 6 тижнів | Білінг, рахунки, DATEV, Mahnwesen |
| R4 | Portal & Analytics | S15–S17 | 6 тижнів | Портал пацієнта, KPI, звіти |
| R5 | Polish & Launch | S18–S19 | 4 тижні | Тестування, безпека, деплой, документація |
| | | **19 спрінтів** | **~38 тижнів** | **~9.5 місяців** |

---

## 2. Технічний стек (фіксований)

```
Backend:    Rust (2024 edition)
            Axum (HTTP framework)
            SQLx (PostgreSQL driver, compile-time checked queries)
            Tokio (async runtime)

Frontend:   Leptos 0.7 (Rust → WASM, SSR + CSR hydration)
            TailwindCSS

Database:   PostgreSQL 16 (RDS, eu-central-1)
            AES-256 encryption at rest (AWS KMS, CMK)

Storage:    S3 (документи, скани, PDF)
            WORM-режим для audit logs

Auth:       AWS Cognito (MFA, user pools)
            або самостійний JWT + argon2

Infra:      AWS eu-central-1 (Frankfurt)
            ECS Fargate або EC2
            CloudFront (CDN для WASM bundle)
            RDS PostgreSQL
            S3 + KMS
            SES (email)

CI/CD:      GitHub Actions
            cargo fmt / clippy / test / audit
            Docker multi-stage build
            Deploy → AWS via Terraform/Pulumi

Monitoring: CloudWatch + Sentry
```

---

## 3. Release 0: Foundation (Спрінти 1–3, тижні 1–6)

> Мета: працюючий каркас з auth, RBAC, audit і порожньою БД. Жодного бізнес-функціоналу, але все безпечне з першого дня.

### Sprint 1 (тижні 1–2): Скелет проєкту

**Deliverables:** працюючий dev-сервер з Hello World через WASM

- [ ] Структура проєкту: workspace з crates
  ```
  gmed-crm/
  ├── Cargo.toml (workspace)
  ├── crates/
  │   ├── server/        (Axum API)
  │   ├── frontend/      (Leptos WASM)
  │   ├── domain/        (бізнес-логіка, моделі)
  │   ├── db/            (SQLx, міграції)
  │   └── shared/        (типи, спільні між server/frontend)
  ├── migrations/
  ├── tests/
  └── infra/             (Terraform/Pulumi)
  ```
- [ ] Axum API сервер з health-check endpoint
- [ ] Leptos frontend: CSR build → WASM bundle через `trunk`
- [ ] Docker multi-stage build (builder → runtime)
- [ ] CI pipeline: `cargo fmt` → `clippy` → `test` → `build`
- [ ] PostgreSQL local (docker-compose) + SQLx setup
- [ ] Базова міграція: `users`, `roles`, `sessions` таблиці
- [ ] `.env` / конфігурація через environment variables

### Sprint 2 (тижні 3–4): Auth + RBAC

**Deliverables:** логін, ролі, захищені ендпоінти

- [ ] Автентифікація: реєстрація, логін, JWT токени (access + refresh)
- [ ] Хешування паролів: Argon2id
- [ ] MFA: TOTP (Google Authenticator / Authy)
- [ ] 10 ролей як Enum: `CEO, CEOAssistant, PatientManager, TeamleadInterpreter, Interpreter, Concierge, Billing, Sales, ITAdmin, Patient`
- [ ] RBAC middleware: перевірка ролі на кожному запиті
- [ ] Row-level security: `patient_assignment` таблиця
- [ ] Авторизаційна функція: `can_access(user, resource, action) → bool`
  - Перевіряє: роль + assignment + data_sensitivity + share_status
- [ ] API: `GET /me`, `GET /users` (тільки CEO/IT), `POST /users` (тільки CEO/IT)
- [ ] Frontend: сторінка логіну, redirect на dashboard

### Sprint 3 (тижні 5–6): Audit + Infra + Encryption

**Deliverables:** immutable audit log, шифрування, AWS setup

- [ ] Audit log таблиця: `who, when, what, context` (append-only)
- [ ] Audit middleware: автоматичний запис для всіх мутацій
- [ ] AES-256 encryption helpers (application-level для чутливих полів)
- [ ] AWS інфраструктура (Terraform/Pulumi):
  - VPC + subnets (private/public)
  - RDS PostgreSQL (encrypted, private subnet)
  - S3 bucket (encrypted, versioned)
  - KMS key (Customer Managed Key)
  - ECS cluster або EC2 instance
  - CloudFront distribution
  - SES для email
- [ ] Перший деплой на AWS dev-environment
- [ ] DSGVO-модель: `consent_records` таблиця (тип згоди, дата, статус, відкликання)
- [ ] Базовий Löschkonzept: soft-delete + crypto-shred endpoint
- [ ] Довідники: країни, мови, категорії документів, типи термінів, статуси

**Мілстоун R0:** Працюючий сервер на AWS з auth, RBAC, audit. Можна логінитись, бачити свій dashboard залежно від ролі. Все зашифроване і логоване.

---

## 4. Release 1: Intake & Case Management (Спрінти 4–7, тижні 7–14)

> Мета: можна створити пацієнта, зібрати анамнез, створити замовлення.

### Sprint 4 (тижні 7–8): Patient Registry

- [ ] Модель `Patient`: stammdaten, контакти (масив), страхування, мови, країна
- [ ] Auto-генерація `patient_id` (формат: `P-YYYYMMDD-XXXX`)
- [ ] CRUD API: `/patients` (create, read, update, list)
- [ ] Зв'язки пацієнтів: родичі, екстрений контакт
- [ ] Правовий статус: DSGVO-згоди, Schweigepflichtentbindung, статус договору
- [ ] `PatientAssignment`: зв'язка patient ↔ staff (CEO призначає)
- [ ] Фільтр: PM бачить тільки своїх пацієнтів
- [ ] Frontend: список пацієнтів, картка пацієнта, форма створення
- [ ] Timeline view (поки порожній, але структура є)

### Sprint 5 (тижні 9–10): Medical Case & Anamnesis

- [ ] Модель `Case`: case_id (auto), patient FK, manager FK, status
- [ ] Anamnesis верхнього рівня: hauptanfragegrund, aktuelle_anamnese, zuweiser
- [ ] Repeater-блоки:
  - `Vorerkrankung[]`: erkrankung(kurz), datum(MM.YYYY), notiz
  - `Allergy[]`: allergie(kurz), reaktion(mittel)
  - `Operation[]`: datum, grund, arzt(FK→Contact), notiz
  - `Medication[]`: 10 полів (handelsname, wirkstoff, dosis+einheit, schema, form, grund, seit, arzt)
  - `PainRecord[]`: 12 полів (wo, seit_wann, ursache, qualität, NRS 1-10, ausstrahlung...)
  - `Symptom[]`: beschreibung, fachrichtung(enum)
- [ ] Impfstatus (freitext mittel)
- [ ] VegetativeAnamnese: appetit, größe, gewicht, veränderungen
- [ ] Frontend: крокова форма анамнезу з "Complete?" валідацією
- [ ] Repeater UI: Add(+) / Remove для кожного блоку
- [ ] NRS slider (1-10) для болів
- [ ] Версіонування: кожна зміна мед. даних зберігає попередню версію
- [ ] Audit trail для всіх медичних змін

### Sprint 6 (тижні 11–12): Lead Intake & Orders

- [ ] Модель `Lead`: контакти, джерело, статус (new → qualified → converted → archived)
- [ ] Lead → Patient конвертація
- [ ] Compliance flow: завантаження документів, статус підпису
- [ ] Модель `FrameworkContract` (рамковий договір)
- [ ] Модель `Order`: patient FK, contract FK, phase enum
  - Phases: `Discovery → Intake → Execution → Closure → FollowUp`
- [ ] Модель `Quote` (Kostenvoranschlag): позиції × кількість × ціна + MWSt
- [ ] Зв'язка Order ↔ Quote
- [ ] Акумуляція послуг: `OrderLeistung[]`
- [ ] Frontend: CRM-view для лідів, форма конвертації, створення замовлення

### Sprint 7 (тижні 13–14): Service Providers & Templates

> Current-state note (2026-04-15): repo вже пішов далі за цей початковий спринтовий план. У коді є provider registry enrichments, provider/patient interaction detail і clinic-level partner templates (`provider_templates`) з generation flow. Цей спринт нижче треба читати як початковий rollout plan, а не як live-status.

- [ ] Модель `Provider`: назва, адреса, тип (medical/non_medical), контакти
- [ ] `ProviderDoctor[]`: лікарі в клініці
- [ ] `ServiceCatalog[]`: послуги з цінами + історія цін
- [ ] `CooperationContract`: умови, ключові дані
- [ ] Пошук провайдерів: фільтр за фахом, локацією, рейтингом, умовами
- [ ] Зв'язки Provider ↔ Patient (інтеракційна історія)
- [ ] Фільтр пацієнтів за клінікою/лікарем
- [ ] Шаблони документів: модель `Template`, генерація з текстових блоків
- [x] Textbausteine з Ausfüllfunktion (merge fields) (`case_text_snippets` current-state)
- [ ] Генерація Patientenaufkleber (наклейки)

**Мілстоун R1:** Повний intake-цикл. Можна: створити ліда → кваліфікувати → конвертувати в пацієнта → зібрати повний анамнез → створити замовлення → підключити клініку.

---

## 5. Release 2: Operations (Спрінти 8–11, тижні 15–22)

> Мета: можна планувати терміни, управляти документами, координувати перекладачів.

### Sprint 8 (тижні 15–16): Appointments & Calendar

> Current-state note (2026-04-15): appointments runtime already covers more than the original plan here: recurring create/update/cancel, true split semantics, scope-aware bulk actions, overlap constraints and live Playwright coverage for whole-series cancellation plus recurrence-rule reshape. Список нижче не є актуальним статусом реалізації.

- [ ] Модель `Appointment`: patient, provider, order, interpreter, type, date/time, location, category
- [ ] Типи: medical / non_medical / internal
- [ ] Зв'язки: Patient ↔ Provider ↔ Staff ↔ Order
- [ ] Створення / редагування термінів (PM)
- [ ] Призначення перекладача до терміну
- [ ] Календар view: PM бачить всі свої терміни
- [ ] CEO: повний календар + фільтрація
- [ ] Teamlead/Dolmetscher/Concierge: свої терміни + нотифікації
- [ ] Відповіді на терміни: Akzeptieren / Rücksprache / Ablehnung
- [ ] Конфлікти часу: detection + Hinweis (без пропозицій)
- [ ] Concierge: мед. терміни як "geblockte Zeitfenster"

### Sprint 9 (тижні 17–18): Documents & Sharing

- [ ] Модель `Document`: auto-name (маска), art, status, visibility, patient, klinik, ursprung
- [ ] Upload → S3 (encrypted)
- [ ] Категоризація при upload: маска → авто-генерація імені
- [ ] Visibility: `internal` / `freigegeben` / `patient_visible`
- [ ] Мультифункціональний перегляд: документ + список для перемикання
- [ ] 5 перевірок перед шерінгом:
  1. Документ freigegeben?
  2. Не internal-only?
  3. Канал дозволений? (договірний/офіційний)
  4. SP задіяний у замовленні?
  5. Мед. документ → тільки мед. SP + підтвердження
- [ ] Мультивибір для масового шерінгу
- [ ] Алерти про відсутні обов'язкові документи (мін. комплект)
- [ ] Freischalten документів для підлеглих

### Sprint 10 (тижні 19–20): PDF Generation & Checklists

- [ ] PDF-генерація плану лікування (мультимовний)
  - Формат: дата → час → процедура + Hinweis-блоки
- [ ] PDF: зведений медикаментний план
- [ ] PDF: Patientenaufkleber
- [ ] Генерація договорів з шаблонів + текстових блоків (Ausfüllfunktion)
- [ ] Чеклісти per-Patient і per-Order
- [ ] Чеклісти per-Appointment: Vorbereitung → Durchführung → Follow-up
- [ ] Автоматичні To-Do списки для PM
- [ ] Нагадування (Reminders): прив'язані до термінів
- [ ] Meldung про необроблені дані/терміни

### Sprint 11 (тижні 21–22): Interpreter & Communication

- [ ] Dolmetscher-Briefing: видимі дані (Stammdaten + термін-інфо)
- [ ] InterpreterReport: години (termingebunden) + текстовий звіт + upload файлів
- [ ] Teamlead flow: перевірка + freigabe годин / звітів / файлів
- [ ] PM: перегляд звітів/годин/документів перекладачів
- [ ] Внутрішня кейсова комунікація (повідомлення за справою)
- [ ] Комунікація PM ↔ клініки/SP
- [ ] Завдання (Tasks): створення, розподіл, статус, дедлайни
- [ ] CEO: комунікація з MA (індивід. / група / за кейсом)
- [ ] Notification system: in-app + email (SES)

**Мілстоун R2:** Повний операційний цикл. Можна: планувати терміни → призначати перекладача → briefing → виконання → звіт → freigabe → документи → шерінг. Чеклісти і нагадування працюють.

---

## 6. Release 3: Finance (Спрінти 12–14, тижні 23–28)

> Мета: повний білінговий цикл від послуги до DATEV-експорту.
>
> Current-state note (2026-04-15): runtime уже значно далі за цей початковий rollout plan. У коді вже є quotes/invoices/dunning/VAT, patient-portal invoices, `external_invoices`, internal cash-based `accounting_entries` ledger / EÜR export, supporting-document auto-link для cost passthrough і order-level finance reports. Реально незакритими тут лишаються переважно зовнішні handoff/integration slices (`DATEV`, `E-Rechnung`, payment provider), а не базовий internal finance runtime.

### Sprint 12 (тижні 23–24): Invoicing Core

- [ ] Модель `Invoice`: тип (Rechnung/KV/Vorkasse/Zwischen/Mahnung), статус, позиції, VAT
- [ ] `InvoiceLineItem`: послуга × кількість × ціна
- [ ] VAT-логіка: власні послуги 19% (завжди, незалежно від країни клієнта), Kostenübernahmen — 0%
- [ ] Авто-збір freigegebener Leistungen від PM
- [ ] Авто-перенесення freigegebener Dolmetscher-Stunden
- [ ] Кошторис (KV): послуги × оцінений обсяг + MWSt
- [ ] Авансовий рахунок (Vorkasse)
- [ ] Проміжний рахунок (Zwischenrechnung): тільки нові позиції
- [ ] Врахування передоплат у фінальному рахунку
- [ ] Нумерація сторінок із прив'язкою до рахунку
- [ ] Leistungsbericht як додаток

### Sprint 13 (тижні 25–26): External Invoices & Mahnwesen

- [ ] Зовнішні рахунки: Kostenübernahme vs Selbstzahler
- [ ] Статуси зовнішніх рахунків: `offen → Prüfung → bezahlt / Mahnung / Abgelehnt / Veraltet`
- [ ] Zahlungsfrist + Meldung при порушенні
- [ ] Авто-прикріплення Belege до Kostenübernahmen
- [ ] Mahnwesen: 1. Mahnung → 2. Mahnung → Inkasso (з freigabe)
- [ ] Нові позиції послуг/продуктів із різними цінами
- [ ] Категоризація для фінаналізу: обороти за послугами/періодом/пацієнтом/клінікою
- [ ] Облік доходів і витрат (EÜR-ready)
- [ ] PDF-генерація рахунків
- [ ] Email-відправка рахунків

### Sprint 14 (тижні 27–28): DATEV, Reports, Concierge

- [ ] DATEV-експорт (формат для податкового консультанта)
- [ ] Finanzamt-konform бухгалтерія: EÜR, GoBD-ready
- [ ] CEO: фінансові звіти (за клінікою, групою пацієнтів, країною, типом послуг)
- [ ] Audit-Log для всіх фінансових змін
- [ ] Concierge: бронювання подорожей/готелів/сервісів (базовий CRUD)
- [ ] VIP-сервіси: документування + облік в білінгу
- [ ] Авто-передача витрат Concierge у Abrechnung
- [ ] Фідбек по клініках + по перекладачах (базовий)
- [ ] Follow-up розклад: 1w, 1m, 6m, 1m до кінця пакету

**Мілстоун R3:** Повний фінансовий цикл. Можна: зібрати послуги → створити рахунок → VAT → відправити → відстежити оплату → Mahnung → DATEV-експорт.

---

## 7. Release 4: Portal & Analytics (Спрінти 15–17, тижні 29–34)

> Мета: портал пацієнта, KPI-дашборди, CEO-модуль.
>
> Current-state note (2026-04-15): patient portal, KPI/reports/risk-analysis/forecasting, secure chat, privacy/export flow і executive read models уже current-state. Цей блок нижче треба читати як ранній rollout plan; фактично відкритими тут лишаються `AI / pseudonymization handoff`, `eIDAS/QES` і зовнішній payment-provider checkout, а не сам базовий portal/analytics slice.

### Sprint 15 (тижні 29–30): Patient Portal

- [ ] Окремий auth flow для пацієнтів (реєстрація, логін, MFA optional)
- [ ] Пацієнт бачить тільки freigegeben елементи
- [ ] Перегляд: плани, документи, терміни, рахунки
- [ ] Upload документів у портал
- [ ] Захищені повідомлення (in-portal messaging)
- [ ] Оплата рахунків (інтеграція з payment provider)
- [ ] Freigabe/відкликання згоди на передачу даних (DSGVO Art. 17)

### Sprint 16 (тижні 31–32): KPI & CEO Dashboard

- [ ] CEO Dashboard: нові пацієнти/міс, активні, retention rate, NPS
- [ ] Фінансові KPI: оборот, Ø рахунок/пацієнт, % вчасно оплачених
- [ ] PM KPIs: к-ть пацієнтів, реакція, Abschlussrate, To-Do items
- [ ] Dolmetscher KPIs: години, зайнятість, FB-score, пунктуальність
- [ ] Billing KPIs: рахунків/міс, Zahlungsmoral, відкриті вимоги
- [ ] CEO: перемикання між модулями (працювати як PM/Billing/Dolmetscher)
- [ ] CEO: управління правами MA
- [ ] CEO: дані продуктивності MA / пацієнтів / клінік

### Sprint 17 (тижні 33–34): SOP, eSign, Extended

- [ ] SOP/Learning модуль: база матеріалів, підтвердження ознайомлення
- [ ] PM/Teamlead: додавання SOPs для команди (з pogodженням)
- [ ] eSignatur інтеграція (EU-провайдер: Swisscom або D-Trust)
- [ ] Двосторонній підпис: Patient → Agency
- [ ] Архівація підписів із timestamp
- [ ] Ризик-аналіз: авто-скринінг складних кейсів (PM), фін. ризик (Billing)
- [ ] Анкета пацієнта (Overall + Агенція + Медицина + Freitext)
- [ ] NPS + Top Promoter Ranking

**Мілстоун R4:** Система повнофункціональна. Портал пацієнта працює. CEO бачить всі KPI. eSign працює. SOPs доступні.

---

## 8. Release 5: Polish & Launch (Спрінти 18–19, тижні 35–38)

> Мета: production-ready. Безпека, тестування, деплой, документація.

### Sprint 18 (тижні 35–36): Security & Testing

- [ ] Penetration testing (OWASP Top 10)
- [ ] Security audit: RBAC review (кожна роль × кожен ендпоінт)
- [ ] Load testing: 10-50 одночасних користувачів
- [ ] Integration tests для всіх критичних flows
- [ ] E2E tests для основних UI-сценаріїв
- [ ] Backup & Recovery тестування (3-2-1 правило)
- [ ] Disaster recovery drill
- [ ] Datenschutz-Folgenabschätzung (DSFA) документ

### Sprint 19 (тижні 37–38): Deploy & Launch

- [ ] Production AWS environment (окремий від dev/staging)
- [ ] DNS + SSL + CloudFront
- [ ] Monitoring: CloudWatch dashboards + алерти
- [ ] Error tracking: Sentry
- [ ] User onboarding: створення акаунтів, MFA setup
- [ ] Міграція даних (якщо є існуючі дані)
- [ ] Технічна документація (API docs, deployment guide)
- [ ] Навчання користувачів (PM, CEO, Billing)
- [ ] Go-live checklist
- [ ] **LAUNCH** 🚀

---

## 9. Залежності між релізами

```
R0 Foundation ──────┐
                     ▼
R1 Intake & Case ───┐
                     ▼
R2 Operations ──────┐
                     ├──▶ R5 Polish & Launch
R3 Finance ─────────┘          ▲
                               │
R4 Portal & Analytics ─────────┘
```

- R0 блокує все (auth, RBAC, audit)
- R1 блокує R2 (потрібні пацієнти і замовлення для термінів)
- R2 блокує R3 (потрібні терміни і послуги для білінгу)
- R3 і R4 можуть частково паралелитись
- R5 — фінальний polish, потребує всі попередні

---

## 10. Ризики і мітігація

| Ризик | Ймовірність | Вплив | Мітігація |
|-------|------------|-------|-----------|
| Вимоги зміняться під час розробки | Висока | Середній | Інкрементальні релізи — адаптація після кожного мілстоуну |
| Складність білінгової логіки DE | Середня | Високий | Консультація з Steuerberater до Sprint 12 |
| eIDAS/QES інтеграція складніша за очікуване | Середня | Середній | Відкладена до R4, можна запуститись без eSign |
| Один розробник — bus factor 1 | Висока | Високий | Чистий код, документація, тести, CI/CD |
| AWS-вартість перевищує бюджет | Низька | Низький | Reserved instances, моніторинг витрат з 1-го дня |

---

## 11. Definition of Done (по спрінтах)

Кожен спрінт вважається завершеним, коли:

- [ ] Код пройшов `cargo fmt` + `clippy` (zero warnings)
- [ ] Юніт-тести для нової бізнес-логіки
- [ ] Integration tests для нових API endpoints
- [ ] Міграції БД працюють (up + down)
- [ ] RBAC перевірено: кожен новий ендпоінт має перевірку ролі
- [ ] Audit log: кожна нова мутація логується
- [ ] Деплой на dev-environment працює
- [ ] Жодних `unwrap()` в production-коді (тільки `?` або explicit error handling)

---

## 12. Мілстоуни для клієнта

| Коли | Що показати клієнту |
|------|---------------------|
| Тиждень 6 | Логін, ролі, порожній dashboard — "система захищена з першого дня" |
| Тиждень 14 | Створити пацієнта, зібрати анамнез, створити замовлення — "core workflow працює" |
| Тиждень 22 | Терміни, документи, перекладачі, чеклісти — "операційний цикл працює" |
| Тиждень 28 | Рахунки, DATEV, Mahnwesen — "фінансовий цикл працює" |
| Тиждень 34 | Портал пацієнта, KPI, eSign — "все працює" |
| Тиждень 38 | Production launch — "система в роботі" |

---

*Документ створено: Квітень 2026*
*Оновлювати після кожного мілстоуну*
