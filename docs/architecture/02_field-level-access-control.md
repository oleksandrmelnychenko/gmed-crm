# Field-Level Access Control: Архітектура

> Як система визначає які саме дані показувати кожній ролі, і як це робити конфігурованим.

## Проблема

Один endpoint `/api/v1/patients/:id` має повертати **різний набір полів** залежно від ролі:

| Поле | CEO | PM | Interpreter | Concierge | Billing | Patient |
|------|-----|----|-------------|-----------|---------|---------|
| name | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| phone | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| diagnosis | ✅ | ✅ | ⚡ за терміном | ❌ НІКОЛИ | ❌ | ⚡ freigegeben |
| medications | ✅ | ✅ | ⚡ за терміном | ❌ НІКОЛИ | ❌ | ⚡ freigegeben |
| insurance | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| invoices | ✅ | ✅ | ❌ | ❌ | ✅ | ⚡ свої |
| travel_data | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| internal_notes | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

⚡ = умовний доступ (залежить від контексту або freigabe)

## 3-рівнева модель

### Level 1: System Rules (код, не змінюється)

Абсолютні заборони. Визначені в `domain/access/policy.rs`. Жодний конфігуратор не може їх обійти.

```
Concierge + Medical → DENY (завжди)
Billing + Medical → DENY (завжди)
Sales + PatientIdentity → DENY (завжди)
Patient + InternalOnly → DENY (завжди)
Unassigned + будь-що → DENY (завжди, крім CEO)
```

Ці правила не мають UI, не зберігаються в БД, не конфігуруються. Вони — закон.

### Level 2: Role Field Policies (БД, конфігурує CEO/IT Admin)

Таблиця в БД, яка визначає: для кожної ролі, для кожного типу сутності, для кожного поля — який рівень доступу.

```sql
CREATE TABLE field_access_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role TEXT NOT NULL,
    entity_type TEXT NOT NULL,       -- 'patient', 'case', 'appointment', 'document', 'invoice'
    field_name TEXT NOT NULL,        -- 'name', 'phone', 'diagnosis', 'medications'...
    access_level TEXT NOT NULL       -- 'full', 'masked', 'hidden', 'conditional'
        CHECK (access_level IN ('full', 'masked', 'hidden', 'conditional')),
    condition_type TEXT,             -- NULL, 'assigned_appointment', 'freigegeben', 'own_data'
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(role, entity_type, field_name)
);
```

Рівні доступу:
- `full` — поле повертається повністю
- `masked` — поле повертається частково (напр. "Dr. M***" або "***@gmed.de")
- `hidden` — поле не повертається взагалі (відсутнє в JSON)
- `conditional` — поле повертається тільки якщо виконана умова (condition_type)

Умови (condition_type):
- `assigned_appointment` — дані показуються тільки якщо пов'язані з терміном, на який призначений цей user
- `freigegeben` — дані показуються тільки якщо share_status = released або patient_visible
- `own_data` — дані показуються тільки якщо належать цьому user (напр. patient бачить свої рахунки)

### Level 3: Per-Record Overrides (БД, керує PM)

Для конкретного запису PM може змінити видимість:

```sql
CREATE TABLE record_access_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    target_role TEXT,                -- NULL = all roles, або конкретна роль
    target_user_id UUID,            -- NULL = all users with role, або конкретний user
    field_name TEXT,                 -- NULL = весь запис, або конкретне поле
    access_level TEXT NOT NULL       -- 'full', 'hidden'
        CHECK (access_level IN ('full', 'hidden')),
    reason TEXT,
    granted_by UUID NOT NULL REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    UNIQUE(entity_type, entity_id, target_role, target_user_id, field_name)
);
```

Приклади:
- PM відкриває конкретний Arztbrief для перекладача Анни:
  `entity_type=document, entity_id=abc, target_user_id=anna_id, access_level=full`
- PM ховає конкретний діагноз від усіх крім CEO:
  `entity_type=case, entity_id=xyz, field_name=diagnosis, target_role=NULL, access_level=hidden`

## Порядок перевірки (pipeline)

```
Запит приходить → 

1. System Rules (Level 1)
   role + data_sensitivity → DENY? → 403 Forbidden, кінець
   
2. Role Field Policy (Level 2)
   role + entity_type + field_name → access_level
   - hidden → прибрати поле з відповіді
   - masked → замаскувати значення
   - conditional → перевірити condition_type
   - full → залишити
   
3. Per-Record Override (Level 3)
   entity_id + target → override access_level
   - Якщо є override → він перевизначає Level 2
   - Level 1 (System Rules) ніколи не перевизначається

4. Сформувати відповідь тільки з дозволених полів
```

## Як це виглядає в коді

### API response serializer

```rust
struct FieldFilter {
    role: Role,
    user_id: Uuid,
    policies: Vec<FieldPolicy>,        // Level 2, завантажені при старті / кешовані
    overrides: Vec<RecordOverride>,     // Level 3, запитуються per-request
}

impl FieldFilter {
    fn filter_patient(&self, patient: PatientFull, assignment: &AssignmentContext) -> serde_json::Value {
        let mut result = serde_json::Map::new();
        
        // Для кожного поля перевіряємо доступ
        for (field_name, value) in patient.to_fields() {
            match self.resolve_access(\"patient\", patient.id, field_name, assignment) {
                AccessLevel::Full => { result.insert(field_name, value); }
                AccessLevel::Masked => { result.insert(field_name, mask(value)); }
                AccessLevel::Hidden => { /* skip */ }
                AccessLevel::Conditional(cond) => {
                    if self.check_condition(cond, assignment) {
                        result.insert(field_name, value);
                    }
                }
            }
        }
        
        serde_json::Value::Object(result)
    }
}
```

### Маскування

```
Email:  oleksandr@gmed.de  →  o***@gmed.de
Phone:  +49 176 1234567    →  +49 *** ***4567
Name:   Dr. Max Müller     →  Dr. M. M***
IBAN:   DE891234567890     →  DE89********7890
```

## Конфігуратор (UI)

### Хто конфігурує
- **Level 2 (Role Policies):** CEO або IT Admin через UI
- **Level 3 (Per-Record):** Patient Manager через контекстне меню на документі/записі

### UI для CEO: Role Access Matrix

```
┌─────────────────────────────────────────────────┐
│ Field Access Configuration                       │
│                                                  │
│ Entity: [Patient ▼]                              │
│                                                  │
│ Field          │ PM    │ Interpr.│ Concierge│ ... │
│ ───────────────┼───────┼─────────┼──────────┼─────│
│ name           │ Full  │ Full    │ Full     │     │
│ birth_date     │ Full  │ Full    │ Hidden   │     │
│ phone          │ Full  │ Full    │ Full     │     │
│ email          │ Full  │ Masked  │ Hidden   │     │
│ diagnosis      │ Full  │ Cond.⚡ │ 🔒System │     │
│ medications    │ Full  │ Cond.⚡ │ 🔒System │     │
│ insurance      │ Full  │ Hidden  │ Hidden   │     │
│ internal_notes │ Full  │ Hidden  │ 🔒System │     │
│                                                  │
│ 🔒 = System rule, cannot be changed              │
│ ⚡ = Conditional (click to configure)            │
│                                                  │
│ [Save Changes]  [Reset to Defaults]              │
└─────────────────────────────────────────────────┘
```

`🔒System` — поля заблоковані Level 1. CEO бачить їх в UI, але не може змінити.

### UI для PM: Per-Record Override

```
┌──────────────────────────────────────────┐
│ Document: Arztbrief Kardiologie          │
│ Patient: Ahmad Al-Rashid                 │
│                                          │
│ Current visibility: Internal Only        │
│                                          │
│ Share with:                              │
│ ☐ Anna Dolmetsch (Interpreter)           │
│ ☐ Teamlead Interpreters                  │
│ ☐ Patient Portal                         │
│                                          │
│ [Confirm Sharing]                        │
│                                          │
│ ⚠️ This is a medical document.           │
│    Sharing requires confirmation.        │
└──────────────────────────────────────────┘
```

## Defaults (seed data)

При першому запуску система заповнює `field_access_policies` значеннями за замовчуванням із RBAC-матриці (docs/backlog/02_rbac-matrix_ua.md). CEO може потім змінити.

```sql
-- Interpreter defaults for Patient entity
INSERT INTO field_access_policies (role, entity_type, field_name, access_level, condition_type) VALUES
('interpreter', 'patient', 'name', 'full', NULL),
('interpreter', 'patient', 'birth_date', 'full', NULL),
('interpreter', 'patient', 'phone', 'full', NULL),
('interpreter', 'patient', 'email', 'masked', NULL),
('interpreter', 'patient', 'nationality', 'full', NULL),
('interpreter', 'patient', 'languages', 'full', NULL),
('interpreter', 'patient', 'diagnosis', 'conditional', 'assigned_appointment'),
('interpreter', 'patient', 'medications', 'conditional', 'assigned_appointment'),
('interpreter', 'patient', 'insurance', 'hidden', NULL),
('interpreter', 'patient', 'internal_notes', 'hidden', NULL),
('interpreter', 'patient', 'invoices', 'hidden', NULL);

-- Concierge defaults for Patient entity
INSERT INTO field_access_policies (role, entity_type, field_name, access_level) VALUES
('concierge', 'patient', 'name', 'full'),
('concierge', 'patient', 'phone', 'full'),
('concierge', 'patient', 'email', 'full'),
('concierge', 'patient', 'nationality', 'full'),
('concierge', 'patient', 'languages', 'full'),
('concierge', 'patient', 'travel_data', 'full'),
('concierge', 'patient', 'diagnosis', 'hidden'),      -- System rule enforces this anyway
('concierge', 'patient', 'medications', 'hidden'),     -- System rule enforces this anyway
('concierge', 'patient', 'internal_notes', 'hidden');
```

## Коли реалізовувати

| Компонент | Коли | Чому |
|-----------|------|------|
| Level 1 (System Rules) | Sprint 2 ✅ DONE | Базова безпека, вже працює |
| Level 2 (field_access_policies table) | Sprint 4 (Patient Registry) | Потрібно коли з'являться реальні сутності з полями |
| Level 2 (CEO UI конфігуратор) | Sprint 16 (CEO Dashboard) | CEO-модуль, не критично для MVP |
| Level 3 (record_access_overrides table) | Sprint 9 (Documents) | Потрібно для document sharing flow |
| Level 3 (PM UI per-record) | Sprint 9 (Documents) | PM має шерити документи |
| Field masking engine | Sprint 4 (Patient Registry) | Щоб API одразу повертав фільтровані дані |
| Audit: хто які поля переглядав | Sprint 4 (Patient Registry) | Разом з першими patient endpoints |

## Наслідки для розробки

1. **Кожен API endpoint** що повертає дані — повинен пропускати response через `FieldFilter`
2. **Не hardcode поля в SQL** — завжди SELECT * (або всі поля), а фільтрувати в Rust перед відправкою
3. **field_access_policies кешувати** — завантажувати при старті + оновлювати при зміні CEO
4. **record_access_overrides запитувати per-request** — вони часто міняються
5. **Audit log** — кожен перегляд чутливих полів логувати
