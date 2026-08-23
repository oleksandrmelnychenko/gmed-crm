# P0 Operations Release Proof

> Актуальний release-proof для операційних модулів GMED станом на **2026-08-23**. Документ фіксує фактичний current-state коду, міграцій і regression coverage; старі unchecked-пункти у planning backlog не означають, що функціонал відсутній.

## 1. Закритий P0 scope

| Потік | Фактичний current-state | Канонічний доказ |
|---|---|---|
| Task Manager | задачі й події, календар, Kanban/list view, внутрішня аудиторія з пацієнтом, зовнішня аудиторія з типом і контактами виконавця | `concierge_operational_items_api.rs`, `operations-p0.live.spec.ts` |
| Внутрішні нотатки | створення, редагування з optimistic locking, пошук, архівація, вкладення PDF/image/Word, encrypted attachment storage | `operations_p0_api.rs`, `operations-p0.live.spec.ts` |
| Concierge workspace | сервіси, партнери, маршрути Google Maps, рекомендації, задачі/події, чеки витрат | `concierge_*_api.rs`, `concierge/model.test.ts`, `operations-p0.live.spec.ts` |
| Витрата консьєржа | чек із постачальником і сумами → finance review → зовнішня витрата/рахунок → дебет пацієнта | `concierge_expense_receipts_api.rs`, `patient_account_statement_api.rs`, `operations-p0.live.spec.ts` |
| Баланс компанії | фінансова позиція, рахунки компанії, рух коштів, зобов'язання постачальникам, review чеків консьєржа | `company_financial_*_api.rs`, `company_provider_settlements_api.rs`, `operations_p0_api.rs` |
| Документи провайдера | upload на профілі провайдера, медичний прапорець, обов'язкова прив'язка медичного документа до пацієнта, пошук і фільтр | `operations_p0_api.rs`, `operations-p0.live.spec.ts` |
| Portal account | активний акаунт пацієнта, редагування email/password, прив'язка до patient card; підписки доступні у portal workspace | `workspace_filters_api.rs`, `patient_portal_subscriptions_api.rs`, `operations-p0.live.spec.ts` |
| Patient doctors | об'єднання explicitly assigned treating doctors та лікарів з clinical history без дублювання рядків | `patient-overview-card.test.ts` |

## 2. P0 RBAC contract

| Workspace / API | Дозволені ролі | Заборонений boundary |
|---|---|---|
| Notes | усі внутрішні staff roles | patient |
| Task Manager API | CEO, Concierge, Billing | Patient Manager та інші ролі поза operational release scope, patient |
| Concierge workspace | CEO, Concierge | Billing та інші staff roles |
| Company Finance | CEO, Billing | Concierge, Patient Manager, patient та інші non-finance roles |
| Provider documents: view | CEO, Concierge, Billing, Patient Manager, Sales, IT Admin | Interpreter, patient |
| Provider documents: upload | CEO, Patient Manager, IT Admin | Concierge, Billing, Sales, Interpreter, patient |

Frontend route guard і backend canonical endpoints перевіряються разом через:

- `frontend/src/lib/staff-route-access.test.ts`
- `frontend/tests/e2e-live/rbac-denied-routes.live.spec.ts`
- `crates/server/tests/operations_p0_api.rs`

## 3. Release verification command set

```text
frontend: pnpm exec vitest run
frontend: pnpm exec tsc -b
frontend: pnpm exec eslint . --max-warnings 0
frontend: pnpm exec vite build
browser:  pnpm exec playwright test -c playwright.live.config.ts tests/e2e-live/operations-p0.live.spec.ts tests/e2e-live/rbac-denied-routes.live.spec.ts
backend:  cargo fmt --all -- --check
backend:  cargo test -p gmed-server --test operations_p0_api --test concierge_operational_items_api
```

На Windows локальний Rust compile потребує MSVC `link.exe`; якщо Build Tools відсутні, Rust integration suite є обов'язковим CI gate, а не пропущеною перевіркою.

## 4. Що не є частиною цього P0

Ці пункти залишаються окремими зовнішніми інтеграціями або наступним release scope:

- DATEV handoff;
- повний E-Rechnung transport;
- реальний payment checkout/settlement provider;
- eIDAS/QES;
- AI handoff/pseudonymization, якщо AI повертається у scope;
- native push delivery для mobile wrapper.

Вони не блокують current internal operations release, але не повинні позначатись як реалізовані.
