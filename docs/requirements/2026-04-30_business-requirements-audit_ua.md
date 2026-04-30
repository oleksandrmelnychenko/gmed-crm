# Аудит бізнес-вимог CRM

Дата: 2026-04-30

## Короткий висновок

- Повністю готового покриття немає майже ні по одному з 12 пунктів.
- Найкраще вже закриті: базовий patient portal, appointments, invoices, documents, timeline, interpreter appointments, document translation workflow.
- Найбільші прогалини: прибутковість по клієнту, приховування сум від пацієнта, база ліків/аналогів, пакети послуг, структуровані рекомендації лікарів, історія перекладач-клієнт.

## 1. Заробіток на конкретному клієнті

Статус: частково є.

Є:

- Є рахунки по пацієнту в `crates/server/src/routes/patients.rs`.
- Є patient invoice tab у фронті в `frontend/src/pages/patients/data/use-patient-detail-tab-data.ts`.
- Є accounting ledger в `crates/server/src/routes/invoices.rs`.
- Є `accounting_entries`, де можна зберігати income/expense з `patient_id`.

Нема:

- Нема повного P&L по клієнту: дохід, витрати, маржа, оплачено, борг, provider costs, interpreter costs.
- Accounting ledger не має нормального patient filter.
- Поточний service report рахує gross volume, але не реальний прибуток.

Що зробити:

- Додати endpoint типу `/patients/{id}/financial-summary`.
- Додати фільтр `patient_id` в accounting ledger.
- На patient detail зробити блок "Client profitability": revenue, expenses, margin, outstanding, collected.
- Додати тести на розрахунок маржі.

## 2. Історія перекладача з клієнтами

Статус: частково є.

Є:

- В appointments є `interpreter_id`.
- `/appointments` підтримує фільтр по interpreter.
- Є interpreter reports з годинами.
- Є feedback score по interpreter.
- Є KPI по перекладачах у stats.

Нема:

- Нема окремого звіту "цей перекладач працював з такими клієнтами стільки-то разів/годин".
- Нема підказки при призначенні: "цей перекладач вже працював з цим клієнтом і feedback був хороший".

Що зробити:

- Додати endpoint `/interpreters/{id}/patient-history`.
- Агрегувати appointment count, approved hours, last appointment, patient feedback.
- У appointment assignment UI показувати рекомендованого перекладача для клієнта.
- Додати фільтр "previously worked with this patient".

## 3. Одна опція, три лікарі, три чеки

Статус: частково можливо вручну, але модель слабка.

Є:

- `order_leistungen` підтримує provider/doctor на кожній service line.
- Можна вручну додати одну й ту саму послугу кілька разів з різними лікарями.
- Є external invoices для чеків/рахунків від провайдерів.

Нема:

- Нема workflow "одна медична опція розбивається на 3 лікарів і 3 чеки".
- Appointment має один `doctor_id`, тобто multi-doctor appointment не моделюється нормально.
- Billing sync з medical appointment зараз обмежений one-to-one.

Що зробити:

- Додати модель service occurrences або multi-doctor participants.
- Дати UI "дублювати послугу для кількох лікарів".
- Генерувати окремі billing lines / provider invoices на кожного лікаря.
- Протестувати кейс: 1 gastro check option, 3 doctors, 3 checks.

## 4. Приховування сум від пацієнта

Статус: майже нема.

Є:

- Є `patient_relations`, тобто можна описувати родичів/caregivers.
- Patient portal має invoices page.
- `/me/invoices` показує пацієнту суми, борг, gross/net/VAT.

Нема:

- Нема payer model: хто платить за кого.
- Нема поля типу `hide_amounts_from_patient`, `portal_visible`, `payer_id`.
- Нема можливості приховати суми або PDF invoice від конкретного пацієнта.
- Нема окремого доступу для дітей/родичів як платників.

Що зробити:

- Додати invoice visibility policy.
- Додати поля для invoice: visible to patient, hide amounts, payer relation/contact.
- Переробити `/me/invoices`, щоб воно поважало ці правила.
- У frontend додати toggle "hide financial details from patient".
- Додати permission tests, щоб пацієнт не міг отримати приховану суму через API/PDF.

## 5. База ліків і аналоги в Німеччині

Статус: нема, є тільки базові medication entries.

Є:

- У case workspace є medications.
- Зберігаються `handelsname`, `wirkstoff`, dosage, regimen.
- Є medication expiry workflow.

Нема:

- Нема drug reference database.
- Нема country-specific product mapping.
- Нема active ingredient matching.
- Нема аналогів у Німеччині.
- Нема джерел/верифікації відповідників.

Що зробити:

- Додати таблиці `drug_products`, `drug_active_ingredients`, `drug_equivalents`, `drug_sources`.
- Зробити search по brand name / active ingredient / country.
- Додати mapping "Kazakhstan product -> active ingredients -> Germany equivalents".
- Додати manual verification status, бо це медично чутлива інформація.
- У medication UI показувати "German equivalents".

## 6. Нагадування пацієнту про рекомендації

Статус: частково є, але не в потрібній формі.

Є:

- Є follow-up milestones у orders.
- Patient portal appointments page показує follow-up dates.
- Пацієнт може створити appointment request.

Нема:

- Нема структурованої рекомендації лікаря типу: "через 3 місяці колоноскопія, рекомендує Dr. X".
- Нема patient decision: accepted / declined / wants appointment / needs consultation.
- Нема окремого patient-facing reminders/recommendations module.

Що зробити:

- Додати таблицю `patient_recommendations`.
- Поля: patient, source doctor, appointment/case/order, recommendation type, text, due date, status, patient decision.
- Додати `/me/recommendations`.
- У portal dashboard показувати recommendation cards.
- Додати дії пацієнта: accept, decline, request appointment.

## 7. Портал: наступні прийоми і рекомендації

Статус: частково є.

Є:

- Patient portal вже існує.
- Є dashboard, appointments, documents, services, invoices, feedback, privacy.
- Є `/me/appointments`, `/me/documents`, `/me/invoices`, `/me/followup-milestones`.

Нема:

- Нема повного блоку рекомендацій лікарів.
- Нема єдиного view "що мені робити далі": upcoming appointments + recommendations + pending decisions.
- Частина медичних рекомендацій не структурована як portal-visible data.

Що зробити:

- Додати patient recommendations widget на dashboard.
- Зробити unified "Next steps" блок.
- Додати visibility rules: що бачить пацієнт, що тільки staff.

## 8. Timeline по пацієнту

Статус: в основі є.

Є:

- Є route `/patients/{patient_id}/timeline`.
- Patient detail frontend завантажує timeline.
- Timeline вже покриває базові події.

Нема:

- Нові сутності не будуть відображатися автоматично: recommendations, medication matching, payer visibility changes, interpreter reuse decision, package consumption.
- Потрібно перевірити повноту event types після додавання нових модулів.

Що зробити:

- Розширити timeline aggregation.
- Додати audit events для нових бізнес-процесів.
- Додати фільтри: фінанси, документи, медицина, appointments, recommendations.

## 9. Різний VAT для терміна і перекладача

Статус: частково є.

Є:

- `order_leistungen` має `vat_rate`.
- `agency_service_catalog` має `vat_rate`.
- Є billing sync для interpreter reports.
- Є billing sync для completed medical appointments.

Нема:

- Нема явної tax policy для сценарію "термін без VAT, перекладач з VAT".
- Потрібно перевірити/задати catalog defaults, щоб автоматична генерація не ставила неправильний VAT.
- Нема UI-пояснення, чому одна service line 0%, а інша 19%.

Що зробити:

- Створити catalog items: appointment/termin fee with 0% VAT, interpreter service with configured VAT.
- Перевірити sync logic, щоб воно брало VAT з catalog.
- Додати тести на invoice з двома lines: one no tax, one taxed.

## 10. Запит пацієнта на переклад документа

Статус: backend workflow частково є, portal request бракує.

Є:

- Є `document_translation_requests`.
- Є staff-side API для створення/оновлення translation requests.
- Є workflow completion.
- Є frontend для document translation workspace.

Нема:

- Пацієнт у portal, схоже, не має власної кнопки "request translation" для свого документа.
- Нема `/me/documents/{id}/translation-requests`.
- Потрібна перевірка document visibility, щоб пацієнт міг просити переклад тільки своїх документів.

Що зробити:

- Додати patient portal endpoint для створення translation request.
- Додати кнопку в patient documents page.
- Додати staff queue для нових запитів.
- Додати тести на access control.

## 11. Розділити листування з клінікою і аналізи

Статус: частково є.

Є:

- Є `appointment_communications`.
- Є documents з category/art/provider/clinic context.
- Є appointment communications UI.

Нема:

- Нема чіткої продуктової моделі "clinic correspondence" окремо від "lab results/analysis".
- Нема гарантованої taxonomy категорій.
- Нема окремих вкладок/фільтрів по клініці: correspondence vs analyses.

Що зробити:

- Стандартизувати document categories: `clinic_correspondence`, `lab_result`, `analysis`, `medical_report`.
- Додати filters/tabs у documents і appointment/provider context.
- Дати можливість прив'язувати communication до documents.
- Додати migration для нормалізації існуючих категорій.

## 12. Пакети послуг і додаткові послуги

Статус: частково є як order services, але package model нема.

Є:

- Є orders.
- Є `order_leistungen`.
- Є service catalog.
- Є package coverage status як process gate.
- Можна вручну додавати додаткові services.

Нема:

- Нема сутності "package".
- Нема included units: 5 doctor visits, 5 interpreter visits, labs.
- Нема consumption tracking.
- Нема overage/add-on logic.
- Нема invoice logic "included in package" vs "extra paid service".

Що зробити:

- Додати `service_packages`, `package_items`, `patient_package_subscriptions`, `package_consumptions`.
- Інтегрувати appointments, interpreter reports, analyses, order Leistungen.
- У UI показувати: included, used, remaining, overage.
- Додаткові послуги мають створювати billable add-on lines.
- Додати тести на пакет 5 visits + 6-й visit як extra.

## Рекомендований план робіт

1. Фінансова база: client profitability, payer model, invoice visibility, VAT templates.
2. Package model: packages, included units, consumption, add-ons, invoice integration.
3. Patient recommendations: doctor recommendations, reminders, patient decisions, portal widgets.
4. Interpreter history: interpreter-patient report, assignment recommendation.
5. Medication equivalence: drug database, active ingredient matching, German equivalents.
6. Multi-doctor billing: one service option to multiple doctors/checks.
7. Documents: patient translation requests, category separation for correspondence/labs.
8. Timeline and audit: додати всі нові event types.
9. Permissions and tests: особливо для financial hiding, patient portal, medical recommendations.

## Дуже детальний план реалізації

Цей розділ описує, що саме потрібно додати в систему: таблиці, API, frontend, права доступу, тести, інтеграції та критерії готовності.

## Загальні архітектурні правила

- Усі нові сутності мають створюватись через SQL migrations у фактичному каталозі `migrations/`.
- Усі patient-facing API мають бути окремими від staff API і починатися з `/me/...`.
- Усі staff API мають перевіряти роль користувача і доступ до пацієнта.
- Усі фінансові поля, які можуть бути приховані від пацієнта, не можна просто ховати на frontend. Їх потрібно не віддавати з backend або віддавати як `null` / redacted response.
- Усі дії, які впливають на гроші, медичні рекомендації, доступ пацієнта або документи, мають писатися в timeline/audit.
- Для кожного нового workflow потрібно додати backend route tests і мінімальні frontend tests для критичних компонентів.
- Для кожної нової таблиці потрібно додати indexes по `patient_id`, `order_id`, `appointment_id`, `created_at`, якщо вони використовуються у фільтрах.
- Для кожної нової patient-visible сутності потрібні поля `portal_visible`, `created_by`, `updated_by`, `created_at`, `updated_at`.
- Для медичних даних, рекомендацій і ліків потрібна явна позначка джерела: хто створив запис, коли, на основі якого документа/прийому.
- Усі новостворені frontend сторінки, panels, tabs, drawers і modals мають базуватись на існуючому UI shell, layout patterns, shared components, spacing, typography, tokens і стилях сайту.
- Нові сторінки не мають створювати окрему візуальну мову, окремий app shell або дизайн, який відрізняється від поточного CRM/patient portal.
- Якщо потрібен новий UI pattern, спочатку перевірити наявні компоненти в `frontend/src/components`, `frontend/src/pages/**/ui`, app shell і поточних сторінках. Новий pattern додавати тільки якщо існуючого недостатньо.
- Patient portal сторінки мають використовувати patient portal shell/navigation і не змішувати staff UI patterns з patient-facing UI.
- Staff сторінки мають використовувати staff authenticated app shell/navigation і не створювати standalone layout.

## Прийняті продуктові рішення

Дата фіксації: 2026-04-30

- Реальний прибуток/маржу по клієнту бачать тільки `Admin/Ceo` і `Billing`.
- `PatientManager` не бачить profit margin. Він може бачити invoices, борг, оплати і операційний фінансовий статус без маржі.
- Payer на MVP не має окремого логіну в portal. Це staff-managed payer contact.
- На MVP не робимо payer portal.
- Якщо суми invoice приховані від пацієнта, patient portal не показує PDF кнопку.
- Якщо суми invoice приховані від пацієнта, backend для patient PDF download повертає `403`.
- Redacted PDF без сум не входить у MVP і може бути окремою future task.
- VAT має братись з `service catalog` / `tax profile`, а не вводитись вручну кожного разу.
- Типовий `termin fee` має tax profile з `0% VAT`.
- Interpreter service має tax profile зі стандартним VAT.
- Interpreter-patient history бачать тільки `Admin/Ceo`, `PatientManager`, `Teamlead Interpreter`.
- Сам `Interpreter` не бачить агреговану patient history і feedback aggregation.
- Додаємо таблицю `interpreter_languages`.
- На MVP `interpreter_languages` не є обов'язковою для заповнення.
- Якщо мови перекладача не заповнені, interpreter suggestion показує `language unknown`, але не блокує перекладача.
- MVP для бази ліків: створити структуру таблиць і ручну curated базу.
- CSV import, external API і автоматичні імпорти ліків відкласти до перевірки джерел, ліцензій і юридичних ризиків.
- Неперевірені medication equivalents не показувати пацієнту.
- German equivalents мають бути довідковою інформацією для staff, не призначенням лікування.

## Етап 0. Підготовка перед розробкою

Ціль: зняти ризики, які можуть зламати архітектуру, якщо почати одразу з UI.

Що зробити:

- Описати єдину схему статусів для фінансів: draft, issued, paid, partially_paid, overdue, cancelled, hidden_from_patient.
- Описати єдину схему patient visibility: visible, hidden, visible_without_amounts, staff_only.
- Описати типи медичних подій для timeline: appointment, recommendation, document, translation_request, medication, package_consumption, invoice, payment, interpreter_assignment.
- Описати service type taxonomy: doctor_visit, interpreter_service, lab_analysis, document_translation, clinic_correspondence, medication_review, package_base, package_overage.
- Перевірити існуючі migrations на конфлікти назв таблиць і колонок.
- Визначити, чи фінансові розрахунки мають базуватися на invoice data, accounting ledger, order Leistungen або на комбінації цих джерел.
- Визначити, які ролі мають бачити прибутковість: admin, finance, owner, case manager.
- Визначити, які ролі можуть приховувати суми від пацієнта.
- Визначити, чи пацієнт бачить ціну пакета, якщо за нього платить родич.
- Визначити легальне правило для VAT по термінах, перекладачах, лабораторіях і додаткових послугах.
- Визначити джерело drug database: ручна curated база, імпорт CSV, external API або комбінація.

Definition of Done:

- Є короткий технічний ADR або section у цьому документі з фінальними правилами.
- Всі назви таблиць, endpointів і permission rules узгоджені до початку migrations.

## Етап 1. Прибутковість по клієнту

Ціль: staff має бачити, скільки компанія реально заробила або втрачає на конкретному клієнті.

### 1.1. Дані, які потрібно додати або нормалізувати

- Перевірити `accounting_entries` і додати, якщо відсутні: `patient_id`, `order_id`, `invoice_id`, `appointment_id`, `provider_id`, `interpreter_report_id`, `source_type`, `source_id`.
- Додати категорії accounting entries: patient_invoice_income, provider_invoice_expense, interpreter_expense, lab_expense, translation_expense, refund, adjustment, package_income, package_overage_income.
- Додати поле `cost_center` або `service_area`: medical, interpreter, documents, lab, package, admin.
- Додати поле `is_pass_through`, щоб відділяти гроші, які проходять через компанію, але не є маржею.
- Додати поле `margin_relevant`, щоб явно виключати технічні або нейтральні записи.
- Додати зв'язок external/provider invoices з `patient_id` та `order_id`, якщо він не завжди заповнений.
- Додати SQL view або materialized view `patient_financial_summary_v`, якщо розрахунок через joins буде важким.

### 1.2. Backend API

- Додати `GET /patients/{patient_id}/financial-summary`.
- Додати query params: `from`, `to`, `order_id`, `include_pass_through`, `currency`.
- Response має містити `revenue_net`, `revenue_vat`, `revenue_gross`, `paid_amount`, `open_balance`, `overdue_amount`, `expenses_net`, `expenses_vat`, `expenses_gross`, `margin_net`, `margin_percent`.
- Response має містити breakdown по orders.
- Response має містити breakdown по service types: doctor visits, interpreter, labs, documents, package, other.
- Response має містити список проблем: invoice without patient_id, expense without patient_id, unmatched provider invoice, missing VAT rate.
- Додати `GET /patients/{patient_id}/financial-ledger`.
- Додати `patient_id` filter до існуючого accounting ledger endpoint.
- Додати permission check: тільки finance/admin/authorized staff.

### 1.3. Frontend staff UI

- У patient detail додати tab або section `Financial`.
- Додати top cards: Total revenue, Total expenses, Net margin, Outstanding balance.
- Додати chart або table по orders.
- Додати table по ledger entries з фільтрами date range, service type, source.
- Додати warnings block для фінансових записів, які не можна точно віднести.
- Додати кнопку export CSV для фінансового звіту по пацієнту.
- Додати loading, empty і error states.

### 1.4. Timeline

- Додати timeline event при створенні invoice.
- Додати timeline event при оплаті invoice.
- Додати timeline event при додаванні provider/interpreter expense.
- Додати timeline event при manual financial adjustment.

### 1.5. Тести

- Тест: пацієнт має 2 invoices, 1 provider expense, 1 interpreter expense, API повертає правильну маржу.
- Тест: unpaid invoice входить у revenue, але open balance не дорівнює paid amount.
- Тест: pass-through expense не враховується в margin, якщо `include_pass_through=false`.
- Тест: user без finance permission не бачить financial-summary.
- Тест frontend: cards показують правильні numbers і red flags.

Acceptance criteria:

- Staff може відкрити пацієнта і за 1 екран побачити, скільки компанія заробила.
- Сума у financial summary звіряється з invoices і accounting ledger.
- API не віддає фінансові summary пацієнту.

## Етап 2. Платник, приховування сум і фінансова приватність

Ціль: якщо за пацієнта платить інша людина, пацієнт не бачить суму, але staff і payer можуть працювати з рахунком.

### 2.1. Дані, які потрібно додати

- Додати relation type `payer` у patient relations, якщо такої ролі ще немає.
- Додати таблицю `invoice_payers`.
- `invoice_payers` має містити: `invoice_id`, `patient_id`, `payer_patient_id`, `payer_relation_id`, `payer_name`, `payer_email`, `payer_phone`, `billing_address`, `is_primary`, `created_by`, `created_at`.
- Додати таблицю `invoice_portal_visibility`.
- `invoice_portal_visibility` має містити: `invoice_id`, `patient_id`, `visible_to_patient`, `amounts_visible_to_patient`, `line_items_visible_to_patient`, `pdf_visible_to_patient`, `reason`, `updated_by`, `updated_at`.
- Додати enum/status для redaction: full, hide_amounts, hide_lines, hide_pdf, hidden.
- Додати audit table або audit event для зміни financial visibility.

### 2.2. Backend API

- Додати staff endpoint `PUT /invoices/{invoice_id}/portal-visibility`.
- Додати staff endpoint `PUT /invoices/{invoice_id}/payer`.
- Оновити `/me/invoices`, щоб він повертав redacted response.
- Якщо `amounts_visible_to_patient=false`, не віддавати `total_net`, `total_vat`, `total_gross`, `paid_amount`, `balance_due`.
- Якщо `line_items_visible_to_patient=false`, не віддавати invoice lines.
- Якщо `pdf_visible_to_patient=false`, endpoint PDF download має повертати 403 або redacted PDF.
- Додати endpoint для payer portal тільки якщо payer матиме окремий login. Якщо ні, payer залишається staff-managed contact.

### 2.3. Frontend staff UI

- На invoice detail додати блок `Portal visibility`.
- Додати toggles: show invoice to patient, show amounts, show line items, allow PDF download.
- Додати поле reason, чому суми приховані.
- На patient detail додати індикатор: `Financial details hidden from patient`.
- На invoice create/edit додати вибір payer.
- На relation card додати роль `Payer`.

### 2.4. Frontend patient portal

- Якщо invoice hidden, не показувати його взагалі.
- Якщо amounts hidden, показувати текст: "Фінансові деталі цього рахунку доступні тільки платнику або staff".
- Не показувати totals, line items, PDF кнопку, якщо backend не дозволяє.
- Якщо appointment або document пов'язані з прихованим invoice, не показувати price на цих екранах.

### 2.5. Тести

- Тест: patient не бачить hidden invoice у `/me/invoices`.
- Тест: patient бачить invoice, але всі суми redacted.
- Тест: patient не може скачати PDF, якщо `pdf_visible_to_patient=false`.
- Тест: staff бачить повний invoice.
- Тест: зміна visibility створює timeline/audit event.
- Тест: frontend не рендерить amount fields, якщо API повернув redacted response.

Acceptance criteria:

- Staff може зробити рахунок видимим без сум.
- Пацієнт не може отримати приховані суми через API напряму.
- Всі зміни visibility видно в audit/timeline.

## Етап 3. Пакети послуг і додаткові послуги

Ціль: продавати пакети типу "5 лікарів, 5 перекладачів, аналізи", рахувати використання і автоматично виставляти extra services.

### 3.1. Дані, які потрібно додати

- Додати таблицю `service_packages`.
- `service_packages` має містити: `id`, `code`, `name`, `description`, `status`, `base_price_net`, `vat_rate`, `currency`, `validity_days`, `created_at`, `updated_at`.
- Додати таблицю `service_package_items`.
- `service_package_items` має містити: `package_id`, `service_type`, `agency_service_id`, `included_quantity`, `unit`, `overage_unit_price_net`, `overage_vat_rate`, `requires_approval`, `sort_order`.
- Додати таблицю `patient_package_subscriptions`.
- `patient_package_subscriptions` має містити: `patient_id`, `order_id`, `package_id`, `status`, `starts_at`, `ends_at`, `sold_price_net`, `sold_vat_rate`, `invoice_id`, `created_by`.
- Додати таблицю `package_consumptions`.
- `package_consumptions` має містити: `subscription_id`, `package_item_id`, `patient_id`, `order_id`, `source_type`, `source_id`, `quantity`, `unit`, `consumption_status`, `is_overage`, `created_order_leistung_id`, `created_at`.
- Додати таблицю `package_adjustments` для manual corrections.
- Додати link з `order_leistungen` до `package_consumption_id`, якщо line створена як overage.

### 3.2. Backend API

- Додати staff CRUD `GET/POST/PUT /service-packages`.
- Додати `POST /orders/{order_id}/package-subscriptions`.
- Додати `GET /patients/{patient_id}/packages`.
- Додати `GET /orders/{order_id}/package-coverage`.
- Додати `POST /package-consumptions/manual`.
- Додати internal service, який при completed appointment пробує списати doctor_visit.
- Додати internal service, який при approved interpreter report списує interpreter_service.
- Додати internal service, який при додаванні lab document або lab order списує lab_analysis.
- Якщо included quantity вичерпана, створити `order_leistung` як overage.
- Якщо `requires_approval=true`, створити pending overage, а не invoice line одразу.

### 3.3. Frontend staff UI

- Додати admin/service settings page для package templates.
- На order detail додати блок `Package`.
- Показати included services: 5 doctor visits, 5 interpreter sessions, labs, translations.
- Показати used/remaining/progress для кожної позиції.
- Додати кнопку `Add extra service`.
- Додати warning: package exhausted.
- При створенні appointment показувати, чи покривається він пакетом.
- При approved interpreter report показувати, чи година входить в пакет або буде extra.
- У invoice/order Leistungen показувати badge: included in package, overage, manual add-on.

### 3.4. Frontend patient portal

- Якщо пакет patient-visible, показати назву пакета і remaining services.
- Якщо фінанси приховані, не показувати ціну пакета.
- Показати, які наступні прийоми входять у пакет.
- Показати, якщо додаткова послуга потребує підтвердження пацієнта.

### 3.5. Тести

- Тест: пакет має 5 doctor visits, перші 5 appointments списуються як included.
- Тест: 6-й appointment створює overage order_leistung.
- Тест: interpreter report списує interpreter unit.
- Тест: manual adjustment повертає один visit назад.
- Тест: package subscription не дозволяє consumption після `ends_at`, якщо немає override.
- Тест: patient portal не показує price, якщо invoice visibility hidden.

Acceptance criteria:

- Staff бачить залишок пакета без ручного підрахунку.
- Додаткові послуги автоматично стають billable або pending approval.
- Invoice чітко відрізняє package base від overage.

## Етап 4. Рекомендації лікарів і нагадування пацієнту

Ціль: лікарська рекомендація має стати структурованою сутністю, яку пацієнт бачить у порталі і по якій може прийняти рішення.

### 4.1. Дані, які потрібно додати

- Додати таблицю `patient_recommendations`.
- Поля: `patient_id`, `case_id`, `order_id`, `appointment_id`, `source_document_id`, `source_provider_id`, `source_doctor_id`, `title`, `recommendation_type`, `description`, `recommended_at`, `due_at`, `priority`, `status`, `portal_visible`, `created_by`, `updated_by`.
- `recommendation_type` має підтримувати: colonoscopy, lab_test, followup_visit, medication_review, imaging, therapy, document_upload, other.
- `status` має підтримувати: draft, active, patient_seen, accepted, declined, scheduled, completed, cancelled, expired.
- Додати таблицю `patient_recommendation_decisions`.
- Поля: `recommendation_id`, `patient_id`, `decision`, `decision_note`, `preferred_date_from`, `preferred_date_to`, `created_at`.
- Додати таблицю `patient_recommendation_notifications`.
- Поля: `recommendation_id`, `notification_type`, `scheduled_at`, `sent_at`, `status`, `channel`.

### 4.2. Backend API

- Staff: `POST /patients/{patient_id}/recommendations`.
- Staff: `GET /patients/{patient_id}/recommendations`.
- Staff: `PUT /patient-recommendations/{id}`.
- Patient: `GET /me/recommendations`.
- Patient: `POST /me/recommendations/{id}/decision`.
- Patient: `POST /me/recommendations/{id}/appointment-request`.
- Додати фільтри: active, due_soon, overdue, completed, by doctor, by type.
- Додати validation: patient може діяти тільки зі своїми visible recommendations.
- Додати automatic timeline event при create, portal visible, patient decision, scheduled, completed.

### 4.3. Frontend staff UI

- У patient detail додати tab/section `Recommendations`.
- Додати create form: title, doctor, provider, type, due date, description, portal visible.
- Додати quick action з appointment detail: `Create recommendation from appointment`.
- Додати quick action з document detail: `Create recommendation from document`.
- Додати status board: active, waiting patient, scheduled, completed.
- Додати indicator overdue recommendations.

### 4.4. Frontend patient portal

- На dashboard додати блок `Next recommended actions`.
- На appointments page додати recommendations поруч з upcoming appointments.
- На окремій сторінці recommendations показувати cards.
- Card має містити: рекомендація, лікар, клініка, due date, коротке пояснення, action buttons.
- Дії: `I want to schedule`, `I already did this`, `I need consultation`, `Decline`.
- Якщо пацієнт обирає schedule, створити appointment request з reference на recommendation.

### 4.5. Тести

- Тест: staff створює recommendation, patient бачить її в `/me/recommendations`.
- Тест: hidden recommendation не видна patient API.
- Тест: patient decision змінює status і створює timeline event.
- Тест: appointment request з recommendation зберігає reference.
- Тест: overdue filter повертає рекомендації з `due_at < today`.

Acceptance criteria:

- Пацієнт заходить у портал і бачить конкретну рекомендацію лікаря.
- Пацієнт може прийняти рішення, а staff бачить це рішення.
- Рекомендація відображається в timeline.

## Етап 5. Patient portal: єдиний блок наступних дій

Ціль: пацієнт має бачити не просто розрізнені сторінки, а зрозумілий список "що далі".

### 5.1. Backend API

- Додати `GET /me/next-actions`.
- Response має об'єднати upcoming appointments, active recommendations, pending documents, pending translation requests, unpaid visible invoices, pending feedback, package overage approval.
- Кожен item має мати: `type`, `title`, `subtitle`, `due_at`, `priority`, `action_url`, `status`.
- Враховувати visibility rules для invoices і documents.
- Не включати financial amount, якщо amounts hidden.

### 5.2. Frontend patient portal

- На dashboard замінити або доповнити існуючі cards блоком `Next actions`.
- Додати сортування за urgency: overdue, due soon, scheduled, informational.
- Додати empty state: немає активних дій.
- Додати action buttons, які ведуть на правильний portal page.
- Додати badges: appointment, recommendation, document, invoice, feedback.

### 5.3. Тести

- Тест: next-actions не включає hidden invoice.
- Тест: next-actions включає active recommendation.
- Тест: next-actions сортує overdue вище future appointment.
- Тест frontend: dashboard рендерить змішані action types.

Acceptance criteria:

- Пацієнт бачить усі свої наступні важливі дії на першому екрані.
- Staff може пояснити пацієнту, що саме той бачить у порталі.

## Етап 6. Історія перекладача з клієнтами

Ціль: при новому appointment staff швидко бачить, який перекладач вже працював з цим пацієнтом і чи був результат хороший.

### 6.1. Дані, які потрібно використовувати або додати

- Використати `appointments.interpreter_id`.
- Використати interpreter reports для approved hours.
- Використати feedback interpreter score.
- Додати, якщо потрібно, таблицю `interpreter_patient_preferences`.
- `interpreter_patient_preferences` має містити: `patient_id`, `interpreter_id`, `preference_status`, `reason`, `created_by`, `created_at`.
- `preference_status` має підтримувати: preferred, neutral, avoid.

### 6.2. Backend API

- Додати `GET /interpreters/{interpreter_id}/patient-history`.
- Додати `GET /patients/{patient_id}/interpreter-history`.
- Додати `GET /appointments/{appointment_id}/interpreter-suggestions`.
- Aggregation має повертати: appointments_count, completed_count, cancelled_count, approved_hours, last_appointment_at, providers, doctors, average_feedback_score, last_feedback_note, preference_status.
- Suggestions мають ранжувати: preferred interpreters, previous successful interpreters, language match, availability, avoid list.

### 6.3. Frontend staff UI

- У appointment create/edit при виборі interpreter показувати suggestions.
- На interpreter profile або reports page показати table patients worked with.
- На patient detail показати `Interpreter history`.
- Додати badges: worked before, high feedback, avoid, unavailable.
- Додати quick action: mark as preferred for this patient.

### 6.4. Тести

- Тест: interpreter history рахує тільки completed/approved work там, де потрібно.
- Тест: preferred interpreter піднімається вище в suggestions.
- Тест: avoid interpreter не пропонується автоматично.
- Тест: feedback score входить у ranking.

Acceptance criteria:

- Staff може за 1-2 кліки побачити, з ким працював конкретний перекладач.
- При новому appointment система пропонує попереднього успішного перекладача.

## Етап 7. Multi-doctor service і три чеки

Ціль: один бізнес-запит може мати кілька лікарів і кілька фінансових документів без ручного хаосу.

### 7.1. Дані, які потрібно додати

- Додати таблицю `order_service_groups`.
- `order_service_groups` має містити: `order_id`, `patient_id`, `title`, `service_type`, `source_appointment_id`, `requested_quantity`, `status`, `created_by`.
- Додати `service_group_id` в `order_leistungen`.
- Додати таблицю `appointment_doctor_participants`.
- `appointment_doctor_participants` має містити: `appointment_id`, `provider_id`, `doctor_id`, `role`, `billing_required`, `status`.
- Розглянути зміну unique index на `source_medical_appointment_id`, щоб не блокувати кілька billing lines для одного appointment. Безпечніший варіант: унікальність має бути по `source_medical_appointment_id + doctor_id + service_type`.
- Додати link external invoice до `order_leistung_id` або `service_group_id`, щоб кожен чек був прив'язаний до конкретного лікаря/лінії.

### 7.2. Backend API

- Додати `POST /orders/{order_id}/service-groups`.
- Додати `POST /order-service-groups/{id}/participants`.
- Додати `POST /order-service-groups/{id}/generate-lines`.
- Генерація lines має створити одну `order_leistung` на кожного doctor participant.
- Додати validation: doctor має належати provider, provider має бути active.
- Додати validation: не можна створити дубль для того самого doctor/service_group без override.
- Додати endpoint для прив'язки external invoice до конкретної generated line.

### 7.3. Frontend staff UI

- У order detail додати workflow `Split service by doctors`.
- Staff вибирає service type, provider, кількох doctors, price/VAT для кожного.
- UI показує preview: 3 doctors -> 3 service lines -> 3 expected checks.
- Після генерації lines показати group card з дочірніми lines.
- У external invoices UI дати вибір, до якої line або doctor відноситься чек.
- У appointment UI показувати multi-doctor participants, якщо appointment спільний.

### 7.4. Тести

- Тест: service group з 3 doctors генерує 3 order_leistungen.
- Тест: неможливо двічі згенерувати line для того самого doctor без override.
- Тест: кожна external invoice прив'язується до правильної line.
- Тест: financial summary враховує всі 3 lines.

Acceptance criteria:

- Staff може створити один медичний запит і розкласти його на 3 лікарів.
- Для кожного лікаря є окрема billing line і окремий чек.
- Це видно в order, invoice, financial summary і timeline.

## Етап 8. VAT policy для терміна і перекладача

Ціль: система автоматично ставить правильний VAT для різних типів послуг.

### 8.1. Дані, які потрібно додати

- Додати або нормалізувати `tax_profiles`.
- `tax_profiles` має містити: `code`, `name`, `vat_rate`, `country`, `valid_from`, `valid_to`, `description`.
- Додати `tax_profile_id` в `agency_service_catalog` або явно зберігати `vat_rate` з catalog snapshot.
- Додати `vat_reason` або `tax_note` для lines, де VAT 0%.
- Додати service catalog entries: termin_fee_no_vat, interpreter_service_vat, lab_service, document_translation.

### 8.2. Backend logic

- При створенні `order_leistung` з catalog копіювати VAT rate у line як snapshot.
- Interpreter billing sync має брати VAT з interpreter service catalog item.
- Medical appointment billing sync має брати VAT з termin/medical organization catalog item.
- Manual line має дозволяти зміну VAT тільки користувачу з finance permission.
- Додати validation: VAT не може бути null для invoiceable line.

### 8.3. Frontend UI

- У service line form показувати VAT rate і tax profile.
- Якщо VAT 0%, показувати причину.
- У invoice preview показувати net, VAT, gross по кожній line.
- У billing sync preview показувати, які VAT будуть застосовані до interpreter і termin.

### 8.4. Тести

- Тест: termin fee створюється з 0% VAT.
- Тест: interpreter service створюється з configured VAT.
- Тест: invoice з двома lines правильно рахує total VAT.
- Тест: non-finance user не може змінити VAT вручну.

Acceptance criteria:

- Staff не має вручну пам'ятати VAT для типових послуг.
- Invoice правильно відображає mixed VAT lines.

## Етап 9. База ліків і аналоги в Німеччині

Ціль: staff може внести препарат з іншої країни і знайти відповідники у Німеччині за діючою речовиною.

### 9.1. Дані, які потрібно додати

- Додати таблицю `drug_products`.
- Поля: `id`, `country_code`, `brand_name`, `normalized_brand_name`, `manufacturer`, `dosage_form`, `strength_text`, `atc_code`, `source_name`, `source_url`, `source_updated_at`, `status`.
- Додати таблицю `drug_substances`.
- Поля: `id`, `name`, `normalized_name`, `synonyms`, `atc_code`.
- Додати таблицю `drug_product_substances`.
- Поля: `drug_product_id`, `substance_id`, `strength_value`, `strength_unit`, `role`.
- Додати таблицю `drug_equivalence_candidates`.
- Поля: `source_product_id`, `target_product_id`, `match_type`, `confidence`, `match_reason`, `verified_by`, `verified_at`, `status`.
- Додати таблицю `patient_medication_matches`.
- Поля: `patient_medication_id`, `source_country_code`, `matched_product_id`, `selected_equivalent_product_id`, `status`, `review_note`, `reviewed_by`, `reviewed_at`.

### 9.2. Import і підтримка бази

- Зробити admin import CSV для drug products.
- Додати нормалізацію назв: lowercase, trim, punctuation removal, transliteration where needed.
- Додати synonyms для діючих речовин.
- Додати механізм ручного підтвердження equivalence.
- Зберігати source і дату оновлення.
- Додати статуси: imported, needs_review, verified, deprecated.

### 9.3. Backend API

- Додати `GET /drug-products/search`.
- Query params: `q`, `country_code`, `substance`, `atc_code`.
- Додати `GET /drug-products/{id}/equivalents?target_country=DE`.
- Додати `POST /patient-medications/{id}/match-drug`.
- Додати `PUT /patient-medication-matches/{id}/verify`.
- Додати staff-only permission, поки немає legal approval для patient-facing display.

### 9.4. Frontend staff UI

- У medication section додати кнопку `Find German equivalent`.
- Показати source medication, active substances, possible German equivalents.
- Показати confidence і reason: same substance, same ATC, same strength, similar form.
- Додати warning: це довідкова інформація, не призначення лікування.
- Додати manual select equivalent.
- Додати status badge: not matched, candidates found, verified, rejected.

### 9.5. Patient portal

- На першому етапі не показувати автоматичні equivalents пацієнту.
- Якщо потрібно показувати, тільки verified equivalents і з disclaimer.
- Не показувати unverified candidates.

### 9.6. Тести

- Тест: пошук brand name знаходить product.
- Тест: product з тією ж active substance знаходить German equivalent.
- Тест: unverified candidate не показується patient API.
- Тест: verified match записується в medication timeline.

Acceptance criteria:

- Staff може знайти німецький відповідник по складу.
- Кожний match має джерело і статус верифікації.
- Система не видає неперевірені медичні поради пацієнту.

## Етап 10. Запит пацієнта на переклад документа

Ціль: пацієнт у порталі може вибрати документ і попросити переклад.

### 10.1. Дані, які потрібно додати або розширити

- У `document_translation_requests` додати, якщо немає: `requested_by_user_id`, `requested_from_portal`, `patient_note`, `target_language`, `patient_visible_status`.
- Додати status для portal flow: requested, accepted, in_progress, completed, rejected, delivered.
- Додати link до translated document, якщо переклад створюється як новий document.

### 10.2. Backend API

- Додати `POST /me/documents/{document_id}/translation-requests`.
- Додати `GET /me/translation-requests`.
- Додати `GET /me/documents/{document_id}/translation-requests`.
- Backend має перевірити, що document належить patient і visible in portal.
- Backend має перевірити, що document не internal/staff-only.
- Staff endpoint має бачити portal request source.
- При завершенні перекладу patient має бачити status completed і translated document, якщо він portal-visible.

### 10.3. Frontend patient portal

- На document card додати кнопку `Request translation`.
- Додати modal: target language, comment, confirmation.
- Після request показати статус.
- На documents page додати filter `Translation requested`.
- Якщо request вже існує, не створювати дубль, а показувати поточний status.

### 10.4. Frontend staff UI

- У documents/translation workspace додати queue `Portal requests`.
- Показати patient note і target language.
- Додати action: accept, reject with reason, mark in progress, complete.
- При complete дати можливість attached translated file або translated text.

### 10.5. Тести

- Тест: patient створює translation request для свого visible document.
- Тест: patient не може створити request для чужого document.
- Тест: patient не може створити request для internal document.
- Тест: duplicate request не створює дубль.
- Тест: completed request стає видимим у portal.

Acceptance criteria:

- Пацієнт може самостійно запросити переклад.
- Staff бачить цей запит у робочій черзі.
- Access control не дозволяє request по чужих або прихованих документах.

## Етап 11. Розділення листування з клінікою і аналізів

Ціль: staff і пацієнт не плутають медичні аналізи з організаційною перепискою.

### 11.1. Дані, які потрібно додати або нормалізувати

- Додати або нормалізувати document categories: clinic_correspondence, lab_result, analysis_result, medical_report, invoice, consent, translation, other.
- Додати `document_kind` або стабілізувати існуюче поле `category`.
- Додати `provider_id`, `doctor_id`, `appointment_id`, `order_id` для documents там, де їх бракує.
- Додати таблицю `document_communication_links`.
- `document_communication_links` має містити: `document_id`, `communication_id`, `link_type`, `created_by`, `created_at`.
- Додати migration для mapping старих categories у нову taxonomy.

### 11.2. Backend API

- Оновити document list filters: category, provider_id, doctor_id, appointment_id, order_id, patient_id.
- Додати endpoint або response field для communication-linked documents.
- Додати validation, що lab result не створюється як clinic correspondence без override.
- Додати staff endpoint для зміни category з audit reason.

### 11.3. Frontend staff UI

- У documents page додати tabs: All, Medical reports, Lab/analysis, Clinic correspondence, Invoices, Translations.
- У appointment detail додати окремі sections: Communications і Documents/Results.
- У provider/clinic context додати фільтр по provider.
- У document upload form зробити category required.
- Якщо staff вибирає clinic correspondence, показувати поля communication channel/status.
- Якщо staff вибирає lab/analysis, показувати поля test date/result date.

### 11.4. Frontend patient portal

- У documents page додати зрозумілі категорії.
- Аналізи і листування мають бути окремими групами.
- Patient не має бачити internal correspondence, якщо воно staff-only.

### 11.5. Тести

- Тест: document filters повертають тільки lab results.
- Тест: clinic correspondence не з'являється в lab tab.
- Тест: patient portal не показує staff-only correspondence.
- Тест: category change створює audit event.

Acceptance criteria:

- У UI чітко видно, де листування, а де аналізи.
- Фільтри працюють по clinic/provider.
- Старі документи отримали коректні категорії або flagged for review.

## Етап 12. Timeline і audit для всіх нових процесів

Ціль: по кожному пацієнту видно, що коли і ким було зроблено.

### 12.1. Нові timeline event types

- `financial_summary_viewed` тільки якщо потрібно audit для фінансів.
- `invoice_visibility_changed`.
- `payer_assigned`.
- `package_assigned`.
- `package_consumed`.
- `package_overage_created`.
- `recommendation_created`.
- `recommendation_patient_decision`.
- `recommendation_completed`.
- `interpreter_preference_changed`.
- `service_group_created`.
- `service_group_lines_generated`.
- `drug_match_created`.
- `drug_match_verified`.
- `translation_requested_by_patient`.
- `translation_completed`.
- `document_category_changed`.

### 12.2. Backend changes

- Розширити `/patients/{patient_id}/timeline`, щоб він забирав нові event types.
- Додати filter `event_type`.
- Додати filter `domain`: finance, medical, documents, appointments, package, portal.
- Додати consistent event payload structure: title, description, source_type, source_id, actor, occurred_at.
- Для sensitive finance events patient portal timeline не має отримувати amounts, якщо вони hidden.

### 12.3. Frontend changes

- У patient timeline додати filter chips.
- Додати icons/badges для finance, medical, documents, package.
- Додати deep link з timeline item до invoice, appointment, recommendation, document.
- Для redacted finance events показувати generic text.

### 12.4. Тести

- Тест: створення recommendation додає timeline event.
- Тест: зміна invoice visibility додає timeline event.
- Тест: patient timeline не показує hidden finance details.
- Тест: staff timeline показує повні details за наявності permissions.

Acceptance criteria:

- Будь-яку важливу дію по пацієнту можна знайти в timeline.
- Timeline не розкриває приховані фінансові дані.

## Етап 13. Permissions і security

Ціль: нові можливості не створюють витоків медичних або фінансових даних.

### 13.1. Permission matrix

- Admin: повний доступ.
- Finance: financial summary, invoices, payer, visibility, VAT, accounting.
- Case manager: appointments, recommendations, documents, package usage без profit margin, якщо не дозволено.
- Medical coordinator: medications, recommendations, doctor/provider data.
- Interpreter manager: interpreter history, interpreter reports, assignment suggestions.
- Patient: тільки `/me/...` і тільки portal-visible дані.
- Payer: тільки якщо буде окремий payer login, і тільки invoices/payment data, які йому призначені.

### 13.2. Backend enforcement

- Не покладатися на frontend hiding.
- Кожний endpoint перевіряє role і ownership.
- Patient endpoints завжди беруть patient_id з authenticated user, не з query param.
- Financial redaction робиться до serialization response.
- Document access перевіряє patient ownership і portal visibility.
- Recommendation decision перевіряє, що recommendation active і visible.

### 13.3. Тести security

- Patient не може отримати чужий document.
- Patient не може отримати hidden invoice amount.
- Patient не може створити translation request для internal document.
- Staff без finance role не бачить margin.
- Staff без permission не змінює VAT.
- Payer, якщо буде реалізований, не бачить медичні документи без окремого consent.

Acceptance criteria:

- Критичні security tests покривають всі нові endpoints.
- Нема endpointу, який віддає patient-controlled `patient_id` без перевірки.

## Етап 14. Звітність і операційні dashboards

Ціль: після додавання даних staff має мати швидкі operational views, а не тільки окремі записи.

Що додати:

- Report `Client profitability`: фільтр по датах, case manager, country, package.
- Report `Interpreter patient history`: interpreter, patient, hours, feedback, last work.
- Report `Recommendations due`: due soon, overdue, accepted, declined.
- Report `Package overages`: package exhausted, overage pending approval, billable overage.
- Report `Translation requests`: requested, in progress, overdue, completed.
- Report `Drug matches needing review`: imported candidates, unverified matches.
- Dashboard alert: hidden invoices with unpaid balance.
- Dashboard alert: recommendations without patient decision.
- Dashboard alert: package consumption above 80%.

## Етап 15. Data migration і backfill

Ціль: нові функції мають працювати не тільки для нових пацієнтів, але і для існуючих даних.

Що зробити:

- Backfill patient_id для accounting/provider/interpreter entries там, де можна вивести через order або appointment.
- Backfill document categories у нову taxonomy.
- Backfill package status: існуючі orders без package залишити як no_package.
- Backfill interpreter-patient history з існуючих appointments.
- Backfill recommendations не робити автоматично без source, але додати manual import/review option.
- Backfill medication substances тільки якщо `wirkstoff` заповнений.
- Позначити ambiguous records як `needs_review`.
- Зробити admin report `Data quality issues`.

## Етап 16. Мінімальний порядок впровадження

Рекомендований порядок, щоб не переробляти одне й те саме:

1. Permission/visibility foundation.
2. Invoice payer і financial hiding.
3. Accounting patient filter і client profitability.
4. Package model, тому що воно впливає на billing.
5. VAT profiles і service catalog hardening.
6. Patient recommendations і `/me/next-actions`.
7. Timeline events для finance/package/recommendations.
8. Interpreter-patient history.
9. Multi-doctor service groups.
10. Patient document translation requests.
11. Document category separation.
12. Drug database і German equivalents.
13. Reports і dashboards.
14. Backfill і data quality screens.
15. Full regression testing.

## Етап 17. Мінімальний MVP scope

Якщо треба зробити швидко першу корисну версію, MVP має включати:

- Financial summary по клієнту на основі існуючих invoices/order Leistungen/accounting entries.
- Invoice visibility: hide invoice, hide amounts, hide PDF.
- Patient recommendations: create by staff, show in portal, patient decision.
- Interpreter history: patient-interpreter aggregate table/report.
- Package consumption для doctor visits і interpreter services.
- Translation request from patient portal.
- Basic document categories: correspondence vs lab/analysis.

Що можна відкласти після MVP:

- Full drug equivalence database з імпортом.
- Advanced package overage approval.
- Payer portal login.
- Materialized financial views.
- Advanced ranking algorithm for interpreters.
- Multi-country medication source automation.

## Етап 18. Повний Definition of Done для всього блоку

- У patient detail staff бачить фінансовий summary і margin.
- Пацієнт не бачить суми, якщо staff їх приховав.
- Платник може бути зафіксований окремо від пацієнта.
- Package має included units, used units і overage.
- 6-та послуга після пакета автоматично стає додатковою.
- Лікарська рекомендація створюється staff і видима пацієнту в portal.
- Пацієнт може прийняти рішення по рекомендації.
- Dashboard пацієнта показує наступні дії.
- Staff бачить історію перекладача з конкретним пацієнтом.
- Одна service option може бути розбита на кілька лікарів і кілька чеків.
- VAT для різних service lines застосовується автоматично.
- Пацієнт може запросити переклад документа з portal.
- Листування з клінікою і аналізи розділені категоріями і UI.
- Timeline показує всі ключові нові події.
- Security tests підтверджують, що hidden finance/medical data не витікають через API.
- Документація оновлена і містить нові roles, endpointи, statuses.

## Розподіл задач на 3 паралельні агенти

Ціль розподілу: кожен агент працює у своєму bounded context, має власні таблиці, API, UI-зони і tests. Перетин дозволений тільки в чітко визначених integration points.

## Правила, щоб агенти не перетинались

- Кожен агент працює у своїй гілці.
- Кожен агент створює тільки свої migrations у зарезервованому timestamp-блоці.
- Кожен агент створює нові route modules замість того, щоб розширювати великі існуючі файли без потреби.
- Якщо потрібна зміна shared-файлу, агент додає її тільки в дозволеному місці або описує required integration patch у своєму фінальному звіті.
- Не можна змінювати чужі migrations, чужі route modules, чужі frontend pages і чужі tests.
- Якщо агенту потрібен API іншого агента, він працює через зафіксований contract type або mock response.
- Shared types мають бути або створені окремо на старті, або належати одному конкретному агенту.
- Всі нові endpointи мають мати route tests.
- Всі patient-facing зміни мають мати permission/security tests.
- Всі фінансові зміни мають проходити через backend redaction, а не тільки frontend hiding.

## Agent 1. Finance, Billing, Packages

Назва гілки: `agent-1-finance-billing-packages`.

Головна відповідальність:

- Прибутковість по клієнту.
- Платник за пацієнта.
- Приховування сум від пацієнта.
- VAT/tax profiles.
- Пакети послуг.
- Overage/add-on billing.
- Фінансова частина timeline.

Покриває вимоги:

- 1. Скільки заробляємо на конкретному клієнті.
- 4. За клієнта платить інша людина, пацієнт не бачить сум.
- 9. Різний VAT для терміна і перекладача.
- 12. Пакети послуг і додаткові послуги.
- Частково 8. Timeline для financial/package подій.

Не відповідає за:

- Patient recommendations.
- Patient document translation requests.
- Drug equivalence database.
- Interpreter-patient history.
- Multi-doctor clinical workflow, крім фінансового врахування generated lines після інтеграції.

Дозволені backend ownership zones:

- `crates/server/src/routes/invoices.rs`
- `crates/server/src/routes/orders.rs`, тільки billing/package частина.
- Новий файл `crates/server/src/routes/patient_financials.rs`.
- Новий файл `crates/server/src/routes/service_packages.rs`.
- Новий файл `crates/server/src/routes/tax_profiles.rs`.
- Новий файл `crates/server/src/services/financial_summary.rs`.
- Новий файл `crates/server/src/services/invoice_visibility.rs`.
- Новий файл `crates/server/src/services/package_consumption.rs`.
- Новий файл `crates/server/src/services/tax_profiles.rs`.

Дозволені migration blocks:

- `20260501090000_*` до `20260501095999_*`.
- Приклади назв: `20260501090000_invoice_visibility.sql`, `20260501091000_patient_financial_summary.sql`, `20260501092000_service_packages.sql`, `20260501093000_tax_profiles.sql`.

Дозволені frontend ownership zones:

- `frontend/src/pages/invoices/**`
- `frontend/src/pages/orders/**`, тільки billing/package UI.
- `frontend/src/pages/patients/**`, тільки financial tab/financial cards.
- Новий frontend module `frontend/src/pages/service-packages/**`, якщо потрібна admin/settings сторінка.
- Нові API клієнти для finance/package в `frontend/src/pages/patients/data/**` або окремому `frontend/src/api/**`, якщо така структура вже використовується.

Backend tasks:

- Додати `GET /patients/{patient_id}/financial-summary`.
- Додати `GET /patients/{patient_id}/financial-ledger`.
- Додати patient filter до accounting ledger.
- Додати invoice payer model.
- Додати invoice portal visibility model.
- Оновити `/me/invoices`, щоб приховані суми не віддавались з backend.
- Заблокувати PDF download, якщо `pdf_visible_to_patient=false`.
- Додати tax profiles або стабілізувати VAT snapshot на service lines.
- Додати service package tables.
- Додати package subscription на order/patient.
- Додати package consumption.
- Додати overage order_leistungen.
- Додати timeline events: invoice_visibility_changed, payer_assigned, package_assigned, package_consumed, package_overage_created.

Frontend tasks:

- Додати financial summary block у patient detail.
- Додати financial ledger table у patient detail.
- Додати invoice visibility controls у invoice detail/edit.
- Додати payer assignment UI.
- Додати package block у order detail.
- Додати package usage progress: included, used, remaining, overage.
- Додати VAT/tax profile display на invoice/order lines.
- Додати redacted state в patient invoice UI, але тільки після backend redaction.

Tests:

- Backend test: financial summary рахує revenue, expenses, margin.
- Backend test: hidden invoice не видна patient API.
- Backend test: amounts hidden не повертає financial fields.
- Backend test: PDF download заборонений для hidden PDF.
- Backend test: package з 5 visits створює overage на 6-й visit.
- Backend test: termin fee має 0% VAT, interpreter service має configured VAT.
- Frontend test: financial cards показують correct values.
- Frontend test: hidden amounts не рендеряться в patient portal.
- Frontend test: package progress правильно показує used/remaining.

Acceptance criteria для Agent 1:

- Staff бачить прибутковість клієнта.
- Staff може приховати суми від пацієнта.
- Backend не віддає приховані суми навіть через direct API call.
- Пакет має included/used/remaining/overage.
- VAT застосовується автоматично по service type.

## Agent 2. Patient Portal, Recommendations, Documents

Назва гілки: `agent-2-portal-recommendations-documents`.

Головна відповідальність:

- Рекомендації лікарів.
- Нагадування пацієнту.
- Єдиний блок next actions у portal.
- Patient document translation request.
- Розділення листування з клінікою і аналізів.
- Patient-facing document/recommendation UI.
- Portal timeline visibility для цих подій.

Покриває вимоги:

- 6. Нагадування через портал.
- 7. Пацієнт бачить наступні прийоми і рекомендації.
- 10. Пацієнт просить переклад документа.
- 11. Розділити листування з клінікою і аналізи.
- Частково 8. Timeline для recommendation/document подій.

Не відповідає за:

- Profitability і margin.
- Package billing engine.
- VAT calculation.
- Drug equivalence.
- Interpreter ranking.
- Multi-doctor billing.

Дозволені backend ownership zones:

- Новий файл `crates/server/src/routes/patient_recommendations.rs`.
- Новий файл `crates/server/src/routes/patient_next_actions.rs`.
- Новий файл `crates/server/src/routes/patient_document_requests.rs`.
- `crates/server/src/routes/documents.rs`, тільки translation request і category separation, без зміни фінансових документів.
- Новий файл `crates/server/src/services/recommendations.rs`.
- Новий файл `crates/server/src/services/next_actions.rs`.
- Новий файл `crates/server/src/services/document_categories.rs`.

Дозволені migration blocks:

- `20260501100000_*` до `20260501105999_*`.
- Приклади назв: `20260501100000_patient_recommendations.sql`, `20260501101000_patient_next_actions.sql`, `20260501102000_document_category_taxonomy.sql`, `20260501103000_portal_translation_requests.sql`.

Дозволені frontend ownership zones:

- `frontend/src/pages/patients/portal-appointments-page.tsx`
- `frontend/src/pages/patients/portal-dashboard-page.tsx`
- `frontend/src/pages/patients/portal-documents-page.tsx`
- Новий module `frontend/src/pages/patients/portal-recommendations-page.tsx`
- `frontend/src/pages/documents/**`, тільки document categories і translation queue.
- Patient portal API client у `frontend/src/pages/patients/data/portal-api.ts`.

Backend tasks:

- Додати таблицю `patient_recommendations`.
- Додати таблицю `patient_recommendation_decisions`.
- Додати таблицю `patient_recommendation_notifications`, якщо потрібні scheduled reminders.
- Додати staff endpoints для створення/оновлення recommendations.
- Додати patient endpoint `GET /me/recommendations`.
- Додати patient endpoint `POST /me/recommendations/{id}/decision`.
- Додати patient endpoint `POST /me/recommendations/{id}/appointment-request`.
- Додати endpoint `GET /me/next-actions`.
- Додати patient endpoint `POST /me/documents/{document_id}/translation-requests`.
- Додати patient endpoint `GET /me/translation-requests`.
- Додати document category taxonomy.
- Додати linking між communication і document, якщо потрібно.
- Додати timeline events: recommendation_created, recommendation_patient_decision, translation_requested_by_patient, translation_completed, document_category_changed.

Frontend tasks:

- Додати recommendations block на patient dashboard.
- Додати next actions block на patient dashboard.
- Додати recommendations page або section.
- Додати action buttons: schedule, already done, need consultation, decline.
- Додати request translation button на patient document card.
- Додати modal для target language і patient note.
- Додати status для translation requests.
- Додати tabs/categories у documents: correspondence, lab/analysis, medical reports, translations.
- Додати staff queue для portal translation requests.
- Додати staff form для створення recommendation з appointment або document.

Tests:

- Backend test: patient бачить тільки portal_visible recommendations.
- Backend test: patient decision змінює status і створює timeline event.
- Backend test: `/me/next-actions` включає active recommendation і upcoming appointment.
- Backend test: hidden invoice не потрапляє в next-actions, якщо Agent 1 contract вже доступний.
- Backend test: patient може запросити переклад тільки свого visible document.
- Backend test: patient не може запросити переклад internal або чужого document.
- Frontend test: dashboard показує next actions.
- Frontend test: recommendation card має правильні actions.
- Frontend test: document translation request modal створює request.
- Frontend test: document categories не змішують correspondence і lab results.

Acceptance criteria для Agent 2:

- Staff створює рекомендацію, пацієнт бачить її в portal.
- Пацієнт може прийняти рішення по рекомендації.
- Dashboard portal має єдиний next actions block.
- Пацієнт може запросити переклад документа.
- Листування з клінікою і аналізи розділені у documents UI.

## Agent 3. Clinical Operations, Interpreter, Medications

Назва гілки: `agent-3-clinical-interpreter-medications`.

Головна відповідальність:

- Історія роботи перекладача з клієнтами.
- Рекомендація перекладача для наступного appointment.
- Multi-doctor service workflow.
- Drug database і German equivalents.
- Clinical timeline events.
- Clinical operational reports.

Покриває вимоги:

- 2. З ким і скільки працював конкретний перекладач.
- 3. Одна опція, три лікарі, три чеки.
- 5. База ліків і відповідники у Німеччині.
- Частково 8. Timeline для clinical/interpreter/medication подій.

Не відповідає за:

- Invoice visibility.
- Payer model.
- Package billing engine.
- Patient portal recommendations.
- Document translation portal request.

Дозволені backend ownership zones:

- Новий файл `crates/server/src/routes/interpreters.rs`.
- Новий файл `crates/server/src/routes/interpreter_patient_history.rs`.
- Новий файл `crates/server/src/routes/order_service_groups.rs`.
- Новий файл `crates/server/src/routes/drug_products.rs`.
- Новий файл `crates/server/src/services/interpreter_suggestions.rs`.
- Новий файл `crates/server/src/services/order_service_groups.rs`.
- Новий файл `crates/server/src/services/drug_matching.rs`.
- `crates/server/src/routes/appointments.rs`, тільки якщо потрібно додати interpreter suggestions або multi-doctor participants, без зміни billing sync Agent 1.
- `crates/server/src/routes/cases.rs` або case workspace routes, тільки medication matching integration.

Дозволені migration blocks:

- `20260501110000_*` до `20260501115999_*`.
- Приклади назв: `20260501110000_interpreter_patient_preferences.sql`, `20260501111000_order_service_groups.sql`, `20260501112000_appointment_doctor_participants.sql`, `20260501113000_drug_reference_database.sql`.

Дозволені frontend ownership zones:

- `frontend/src/pages/appointments/**`, тільки interpreter suggestions і multi-doctor participants UI.
- `frontend/src/pages/providers/**`, якщо потрібна provider/doctor participant view.
- `frontend/src/pages/case-workspace/**`, тільки medication matching/German equivalents.
- `frontend/src/pages/reports/**`, тільки interpreter/clinical operational reports.
- Новий module `frontend/src/pages/interpreters/**`, якщо потрібно.
- Новий module `frontend/src/pages/drugs/**`, якщо потрібен admin drug database UI.

Backend tasks:

- Додати `GET /interpreters/{id}/patient-history`.
- Додати `GET /patients/{id}/interpreter-history`.
- Додати `GET /appointments/{id}/interpreter-suggestions`.
- Додати interpreter-patient preference model: preferred, neutral, avoid.
- Додати aggregation по appointments, interpreter reports, feedback.
- Додати `order_service_groups`.
- Додати `appointment_doctor_participants`.
- Додати generation service: service group -> multiple order_leistungen.
- Не змінювати package/overage logic Agent 1; тільки створювати standard order_leistungen або integration hook.
- Додати drug reference tables.
- Додати drug search endpoint.
- Додати German equivalents endpoint.
- Додати patient medication matching endpoint.
- Додати verification flow для equivalents.
- Додати timeline events: interpreter_preference_changed, service_group_created, service_group_lines_generated, drug_match_created, drug_match_verified.

Frontend tasks:

- У appointment create/edit показати interpreter suggestions.
- На patient detail або appointment UI показати interpreter history.
- Додати action: mark interpreter preferred/avoid for patient.
- Додати UI `Split service by doctors`.
- Додати preview: 3 doctors -> 3 billing lines/checks.
- У case medication section додати `Find German equivalent`.
- Показати candidates, active substances, confidence, verification status.
- Додати admin/reports screen для drug matches needing review.
- Додати reports по interpreter-patient history.

Tests:

- Backend test: interpreter history рахує appointments і hours.
- Backend test: preferred interpreter піднімається в suggestions.
- Backend test: avoid interpreter не пропонується.
- Backend test: service group з 3 doctors створює 3 order_leistungen.
- Backend test: duplicate doctor line не створюється без override.
- Backend test: drug search знаходить product за brand/substance.
- Backend test: German equivalent показується тільки verified або marked candidate залежно від endpoint.
- Frontend test: suggestions UI показує worked before/high feedback.
- Frontend test: split service preview показує правильну кількість lines.
- Frontend test: medication equivalent candidates рендеряться з warning.

Acceptance criteria для Agent 3:

- Staff бачить, з ким працював перекладач і скільки.
- Система пропонує перекладача, який вже добре працював з пацієнтом.
- Один clinical service можна розбити на кілька лікарів.
- Для кожного лікаря створюється окрема service line.
- Staff може знайти німецький відповідник ліків за діючою речовиною.

## Shared integration points

Ці файли потенційно потрібні всім, тому їх не можна хаотично редагувати.

`crates/server/src/routes/mod.rs`:

- Власник інтеграції: Agent 1.
- Agent 2 і Agent 3 не редагують напряму або редагують тільки після синхронізації.
- Agent 2 і Agent 3 у фінальному звіті дають точні route mount lines, які треба додати.

`frontend/src/App.tsx`:

- Власник інтеграції: Agent 2.
- Agent 1 і Agent 3 не додають top-level routes напряму.
- Якщо потрібна сторінка, вони створюють module/page і описують route для підключення.

`frontend/src/lib/staff-route-access.ts`:

- Власник інтеграції: Agent 2.
- Agent 1 і Agent 3 не змінюють nav/access без погодження.

`crates/server/src/routes/patients.rs`:

- Не розширювати великими новими блоками.
- Agent 1 створює `patient_financials.rs`.
- Agent 2 створює `patient_recommendations.rs`.
- Agent 3 створює `interpreter_patient_history.rs`.
- Якщо потрібно додати mount під `/patients/{id}/...`, робити через окремий route module.

`frontend/src/pages/patients/**`:

- Agent 1 володіє financial tab/cards.
- Agent 2 володіє portal dashboard/portal documents/portal recommendations.
- Agent 3 володіє interpreter history widget, якщо він у staff patient detail.
- Не редагувати один і той самий component. Якщо потрібен спільний patient detail tab registry, один агент створює extension point, інші додають окремі child components.

`frontend/src/pages/orders/**`:

- Agent 1 володіє package/billing/overage UI.
- Agent 3 володіє multi-doctor service group UI.
- Не змінювати один і той самий service line component одночасно.
- Якщо потрібен shared badge, створити окремий reusable component з чіткою назвою.

`migrations/**`:

- Agent 1 використовує `2026050109xxxx`.
- Agent 2 використовує `2026050110xxxx`.
- Agent 3 використовує `2026050111xxxx`.
- Ніхто не редагує чужі migrations.
- Якщо migration залежить від чужої таблиці, агент не створює FK одразу, а додає nullable column або записує dependency note для integration pass.

## API contracts між агентами

Agent 1 має зафіксувати contract для invoice visibility:

- `InvoicePortalVisibility`
- `visible_to_patient`
- `amounts_visible_to_patient`
- `line_items_visible_to_patient`
- `pdf_visible_to_patient`
- `redaction_reason`

Agent 2 використовує цей contract у patient portal:

- Якщо amounts hidden, не показує суми.
- Якщо invoice hidden, не додає invoice у next actions.
- Якщо PDF hidden, не показує download action.

Agent 1 має зафіксувати contract для package status:

- `package_id`
- `package_name`
- `included_quantity`
- `used_quantity`
- `remaining_quantity`
- `overage_quantity`
- `requires_patient_approval`

Agent 2 може показати package next action тільки через цей contract, але не змінює package engine.

Agent 3 має зафіксувати contract для generated service lines:

- `service_group_id`
- `doctor_id`
- `provider_id`
- `generated_order_leistung_id`
- `billing_required`
- `expected_external_invoice`

Agent 1 використовує це для financial summary і invoice generation, але не змінює clinical service group logic.

Agent 2 має зафіксувати contract для recommendations:

- `recommendation_id`
- `patient_id`
- `title`
- `recommendation_type`
- `source_doctor_id`
- `due_at`
- `status`
- `portal_visible`
- `patient_decision`

Agent 3 не створює recommendations напряму, але може створювати clinical source data, з якої Agent 2 workflow створює recommendation.

## Порядок паралельної роботи

День 1:

- Agent 1 створює migrations/contracts для finance, visibility, packages.
- Agent 2 створює migrations/contracts для recommendations, next actions, document requests.
- Agent 3 створює migrations/contracts для interpreter history, service groups, drug database.

День 2:

- Agent 1 робить backend APIs для financial summary, invoice visibility, packages.
- Agent 2 робить backend APIs для recommendations, next actions, portal translation requests.
- Agent 3 робить backend APIs для interpreter history, service groups, drug search.

День 3:

- Agent 1 робить staff UI для finance/package/invoice visibility.
- Agent 2 робить patient portal UI для recommendations/next actions/documents.
- Agent 3 робить staff UI для interpreter suggestions/multi-doctor/drug equivalents.

День 4:

- Agent 1 додає backend фінансові/security tests.
- Agent 2 додає portal permission і document/recommendation tests.
- Agent 3 додає clinical/interpreter/drug tests.

День 5:

- Agent 1 інтегрує route registrations backend.
- Agent 2 інтегрує frontend routes/nav.
- Agent 3 перевіряє, що clinical generated lines коректно віддаються для finance.
- Після цього робиться загальний regression run.

## Merge order

1. Agent 1 migrations для invoice visibility, tax profiles, packages.
2. Agent 2 migrations для recommendations/documents.
3. Agent 3 migrations для interpreter/service groups/drugs.
4. Agent 1 backend finance/package APIs.
5. Agent 2 backend portal/recommendation/document APIs.
6. Agent 3 backend clinical/interpreter/drug APIs.
7. Agent 1 staff finance/package UI.
8. Agent 2 portal UI і route/nav integration.
9. Agent 3 clinical staff UI.
10. Final integration pass: routes, App routes, nav, tests, timeline consistency.

## Заборонені перетини

- Agent 2 не змінює invoice visibility logic у backend.
- Agent 3 не змінює package consumption engine.
- Agent 1 не змінює drug matching і interpreter ranking.
- Agent 1 не змінює patient recommendations workflow.
- Agent 2 не змінює VAT або financial summary formulas.
- Agent 3 не змінює patient portal invoice/document redaction.
- Ніхто не редагує чужі migrations.
- Ніхто не робить large refactor shared pages під час паралельної роботи.

## Фінальний звіт кожного агента

Кожен агент після роботи має дати:

- Список змінених файлів.
- Список створених migrations.
- Список нових endpointів.
- Список нових frontend screens/components.
- Список tests, які додані або оновлені.
- Які shared integration lines треба додати.
- Які API contracts він очікує від інших агентів.
- Які ризики залишились.

## Примітка

Цей аудит був виконаний без змін у коді. Тести не запускались, тому що перевірка була read-only.
