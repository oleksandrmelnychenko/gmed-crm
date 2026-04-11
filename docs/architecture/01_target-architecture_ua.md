# Target Architecture (UA)

> Продуктове **ядро джерел:** `docs/00_source-of-truth_ua.md` (оригінальні PDF + Excel). Функціональний scope у `docs/requirements/03_product-backlog_ua.md` **вирівняний рядок-у-рядок** з аркушем `User Stories` (генерація: `python scripts/generate_product_backlog_from_excel.py`). Інші вимоги: `docs/requirements/01_process-mapping_ua.md`, `02_anamnese-flow_ua.md`, `docs/backlog/`.
>
> Це канонічний архітектурний документ у межах `docs/architecture/`.

## 1. Архітектурна мета

Потрібна система для медичного агентства, яка:

- веде повний шлях `lead -> patient -> order -> treatment program -> billing -> follow-up`;
- зберігає чутливі медичні дані з жорстким `need-to-know`;
- координує внутрішні ролі, партнерські клініки, перекладачів і concierge;
- дає пацієнту контрольований портал для документів, підпису і оплат;
- формує KPI, audit trail і основу для майбутнього AI-контуру.

## 2. Рекомендований стиль

Для старту рекомендовано `modular monolith`, а не набір мікросервісів.

Причини:

- домен складний, але команда і продукт ще на етапі формування;
- потрібні транзакційна цілісність, аудит і жорстка доменна модель;
- більшість критичних сценаріїв сильно зв'язані: пацієнт, кейс, документи, терміни, білінг;
- окремі інтеграції можна винести в асинхронні воркери без передчасного розщеплення системи.

## 3. Верхньорівнева схема

```text
Internal Backoffice UI
Patient Portal UI
        |
        v
API / BFF Layer
        |
        v
Application Core (modular monolith)
  - IAM / RBAC
  - CRM / Lead Intake
  - Patient Registry
  - Medical Case & Anamnesis
  - Orders & Contracts
  - Provider Registry
  - Appointment Orchestration
  - Documents & Sharing
  - Communication & Tasks
  - Billing & Payments
  - Reporting & KPI
  - Consent / Audit / Compliance
        |
        +--> PostgreSQL
        +--> Object Storage
        +--> Search Index
        +--> Queue / Jobs
        +--> External Integrations
```

## 4. Основні модулі

### 4.1 IAM / RBAC

Відповідає за:

- автентифікацію співробітників і пацієнтів;
- MFA для внутрішніх ролей;
- рольові та контекстні права;
- перевірку доступу на рівні запису та документа.

Базове правило доступу:

`permission = role + assignment + data sensitivity + share status`

### 4.2 CRM / Lead Intake

Покриває:

- реєстрацію ліда;
- первинний контакт і кваліфікацію;
- фіксацію compliance-статусу;
- конвертацію ліда в пацієнта / клієнта.

### 4.3 Patient Registry

Покриває:

- базовий профіль пацієнта;
- контакти, мови, країни, страхові дані;
- пов'язаних осіб, emergency contacts;
- legal/compliance статуси.

### 4.4 Medical Case & Anamnesis

Покриває:

- створення `Case`;
- секції анамнези та симптомів;
- версійність медичних даних;
- клінічні суб-флоу за напрямом;
- медичні summary для провайдерів.

### 4.5 Orders & Contracts

Покриває:

- рамковий договір;
- замовлення (`Order / Auftrag`);
- кошторис;
- етапи підписання та активації;
- фінальне закриття замовлення.

### 4.6 Provider Registry

Покриває:

- партнерські клініки;
- лікарів;
- немедичних провайдерів;
- прайси, договори, шаблони, історію співпраці.

### 4.7 Appointment Orchestration

Покриває:

- лікувальний план;
- медичні та немедичні терміни;
- призначення перекладача;
- часові конфлікти;
- checklists, reminders, follow-up actions.

### 4.8 Documents & Sharing

Покриває:

- імпорт і категоризацію;
- генерацію PDF;
- контроль шерингу;
- patient-visible / provider-shareable / internal-only політики;
- eSign lifecycle.

### 4.9 Communication & Tasks

Покриває:

- внутрішню кейсову комунікацію;
- повідомлення ролям;
- задачі та дедлайни;
- інтеграцію з email / portal notifications.

### 4.10 Billing & Payments

Покриває:

- кошториси;
- авансові, проміжні і фінальні рахунки;
- cost pass-through;
- облік годин перекладача і concierge;
- платежі, дебіторку, нагадування.

### 4.11 Reporting & KPI

Покриває:

- операційні KPI;
- CEO dashboard;
- аналітику по клініках, лікарях, менеджерах;
- feedback aggregation.

### 4.12 Consent / Audit / Compliance

Покриває:

- DSGVO/GDPR consent lifecycle;
- відкликання дозволів;
- retention / deletion policy;
- незмінний журнал подій.

## 5. Доменні сутності

Ключові сутності:

- `Lead`
- `Patient`
- `PatientAssignment`
- `Case`
- `AnamnesisSection`
- `Provider`
- `Order`
- `Quote`
- `Appointment`
- `Task`
- `Document`
- `ShareGrant`
- `Invoice`
- `Payment`
- `InterpreterReport`
- `ConciergeService`
- `AuditEvent`
- `ConsentRecord`

## 6. Дані та сховища

### PostgreSQL

Основне транзакційне сховище для:

- пацієнтів, кейсів, замовлень, термінів, ролей, фінансів;
- версій документ-метаданих;
- журналів бізнес-подій;
- KPI-ready timestamps і статусів.

### Object Storage

Для:

- PDF, сканів, перекладів, шаблонів;
- вкладень перекладачів;
- фінансових підтверджень;
- версій великих файлів.

### Search Index

Опційно для другого етапу:

- пошуку по документах;
- пошуку по пацієнтах, провайдерах, термінах;
- фільтрації по категоріях і тегах.

### Queue / Job Workers

Асинхронні задачі:

- генерація PDF;
- OCR / категоризація;
- email і notification dispatch;
- нагадування та SLA jobs;
- експорт у бухгалтерію;
- майбутні AI / anonymization jobs.

## 7. Події та інтеграційні точки

Ключові доменні події:

- `LeadQualified`
- `PatientCreated`
- `CaseOpened`
- `OrderSigned`
- `QuoteApproved`
- `AppointmentScheduled`
- `InterpreterAssigned`
- `DocumentShared`
- `InvoiceIssued`
- `PaymentReceived`
- `FollowUpCreated`

Зовнішні інтеграції:

- email/SMTP;
- eSign provider;
- payment provider;
- календарі / ICS / email invites;
- OCR / translation tooling;
- бухгалтерський експорт;
- AI gateway для знеособлених даних.

## 8. Безпека і комплаєнс

Обов'язкові вимоги:

- `AES-256` для даних at-rest;
- `TLS 1.3` для передачі;
- MFA для співробітників;
- row-level / context-level authorization;
- окремі політики для `medical`, `financial`, `internal` і `shareable` даних;
- незмінний audit trail;
- політики consent, revocation, retention, deletion;
- резервні копії та disaster recovery.

## 9. Логічні інтерфейси

### Internal Backoffice

Ролі:

- CEO
- CEO Assistant
- Patient Manager
- Teamlead Interpreter
- Interpreter
- Concierge
- Billing
- Sales
- IT Admin

### Patient Portal

Функції:

- перегляд відкритих документів і планів;
- eSign;
- безпечне завантаження;
- рахунки та оплата;
- захищені повідомлення.

## 10. Рекомендована поетапна реалізація

### Phase 1

- IAM / RBAC
- Patient Registry
- Case / Anamnesis
- Orders / Quotes
- Document basics

### Phase 2

- Appointments
- Provider registry
- Interpreter workflow
- Concierge basics
- Task engine

### Phase 3

- Billing
- Patient portal
- eSign
- notifications

### Phase 4

- KPI / analytics
- SOP / learning
- AI-ready anonymization layer

## 11. Що важливо не робити на старті

- Не дробити одразу все на мікросервіси.
- Не змішувати patient portal і internal backoffice в одну модель доступу без явних bounded contexts.
- Не будувати AI поверх сирих персональних медичних даних.
- Не відкладати audit та consent на "потім".

## 12. Рішення по стеку

Якщо продовжувати цей репозиторій у Rust-напрямку, прагматичний стек виглядає так:

- `Rust` для backend API та доменної логіки;
- `PostgreSQL` як головна БД;
- `S3-compatible object storage` для файлів;
- `background jobs` для PDF/OCR/notifications;
- окремий web frontend для backoffice і portal.

Якщо стек ще не зафіксований, спочатку варто затвердити доменну модель і межі модулів, а вже потім обирати конкретний frontend/backend framework.
