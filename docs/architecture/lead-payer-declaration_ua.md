# «Кто платит»: декларація платника ліда, кілька громадянств, підпис GMED останнім

> Статус: реалізовано в гілці `claude/lead-citizenships-payer` (рішення власника 2026-10-03). Документ описує технічну реалізацію. **Це не юридична консультація**: формулювання з розділу «Перевірка юриста» мають бути підтверджені юристом до продуктивного використання.

## 1. Кілька громадянств (ISO 3166-1 alpha-2)

- `leads.citizenships`, `patients.citizenships` (`TEXT[]`, CHECK на коди з двох великих латинських літер; міграція `20261003100100_citizenships.sql`). Сервер приймає лише відомі коди ISO 3166-1 alpha-2, нормалізує до верхнього регістру, прибирає повтори, не більше 10 (`services/citizenships.rs`).
- Лід: `citizenships` у `POST /leads` і `POST /leads/{id}/update`, повертається в картці ліда й у списку. Перше громадянство зберігається також як `wizard_state.registration_country`, а при створенні пацієнта — як `patients.nationality`, щоб старі читачі (шаблони PDF, документи) працювали без змін.
- Пацієнт: `GET /patients/{id}` повертає `citizenships` за тим самим правилом видимості, що й `nationality`; `POST /patients/{id}/update` приймає `citizenships` (перше → `nationality`). Картка пацієнта показує й редагує список (`CitizenshipMultiSelect`).
- Проспект і конвертація: картка пацієнта, створена з ліда, бере список ліда; наявний пацієнт (повторне звернення) зберігає свої громадянства й отримує додаткові з ліда.
- Заповнення історичних даних — міграція `20261003110100_citizenships_backfill.sql`: значення `registration_country` і `patients.nationality`, які є кодом ISO або назвою країни німецькою, англійською чи російською (ті самі назви, що й у `countryCodeFromStoredValue` фронтенду), застарілою англійською назвою або демонімом старої форми («German», «Ukrainian» …). Рядки з уже заповненими громадянствами не змінюються; кількість нерозпізнаних значень пишеться в NOTICE міграції. Перелік нерозпізнаних значень:

```sql
SELECT 'lead' AS source, wizard_state ->> 'registration_country' AS value, count(*)
FROM leads
WHERE citizenships = '{}' AND NULLIF(btrim(wizard_state ->> 'registration_country'), '') IS NOT NULL
GROUP BY 2
UNION ALL
SELECT 'patient', nationality, count(*)
FROM patients
WHERE citizenships = '{}' AND NULLIF(btrim(nationality), '') IS NOT NULL
GROUP BY 2
ORDER BY 3 DESC;
```

## 2. Декларація платника (`lead_payer_declarations`)

Одна на лід (`lead_id` — первинний ключ). Поля, які читає скринінг санкцій (агент B), мають фіксовані назви: `lead_id`, `payer_kind` (`self` | `third_party`), `first_name`, `last_name`, `date_of_birth`, `citizenships`, `country`.

| Блок | Поля | Обов'язковість |
|---|---|---|
| Хто платить | `payer_kind` | завжди |
| Власний економічний інтерес (GwG, wirtschaftlich Berechtigter) | `acts_on_own_account`; якщо ні — `beneficial_owner_name`, `beneficial_owner_note` | ім'я бенефіціара, якщо не в власних інтересах |
| Походження коштів (пацієнта або третьої особи) | `source_of_funds` (`employment`, `business_income`, `savings`, `asset_sale`, `inheritance_gift`, `other`), `source_of_funds_description`, `source_of_funds_document_id` | категорія; опис для `other`; документ — необов'язково |
| Третя особа | `first_name`, `last_name`, `date_of_birth`, `place_of_birth`, `street`, `zip`, `city`, `country` (ISO), `citizenships` (ISO, кілька), `relationship`, `email`, `phone` | ім'я, прізвище, дата народження, адреса, країна, хоча б одне громадянство |
| Інформування платника (Art. 14 DSGVO) | `payer_informed_at`, `payer_informed_by` (галочка співробітника «Плательщик проинформирован об обработке его данных», час і автор фіксуються сервером) | для третьої особи |

- API: `GET /leads/{id}/payer-declaration` (декларація + статус: чого бракує, стан Kostenübernahmeerklärung, підписи заказу, чи може GMED підписати, країни для AML), `POST /leads/{id}/payer-declaration` (зберігає й повертає те саме). Неповну декларацію можна зберегти; статус показує, чого бракує.
- Мінімізація даних: для `self` сервер очищає дані третьої особи, для «власних інтересів» — бенефіціара.
- Аудит: кожна зміна — рядок `update_lead_payer_declaration` (старе/нове значення) у тій самій транзакції. Зміна платника замовлення з декларації — рядок `set_order_payer` з `context.source = lead_payer_declaration`.
- Після конвертації декларація належить пацієнту (`patient_id`, короткий підсумок у `patients.legal_status.payer_declaration`), змінити її через лід не можна (409). Видалення/анонімізація неконвертованого ліда видаляє декларацію; декларація конвертованого ліда зберігається з картою пацієнта (§ 8 Abs. 4 GwG).

## 3. Платник замовлення і Kostenübernahmeerklärung

- Третя особа стає платником усіх замовлень ліда (`orders.payer_*`, роль `cost_bearer`) — це та сама модель платника, що й для рахунків (`architecture/invoice-payer-model_ua.md`); нове замовлення ліда отримує платника одразу при створенні. Повернення до `self` прибирає `cost_bearer` і не чіпає іншого платника (наприклад, батьків як сторону договору).
- Документ «Kostenübernahmeerklärung» (шаблон `cost_coverage_declaration`, тепер доступний і для ліда) називає конкретне замовлення (номер, дата, пацієнт) і платника з декларації; у `generated_bindings._payer_identity_version` записується версія платника. Після зміни імені, дати народження чи адреси платника старий документ більше не зараховується («Cost assumption declaration names another payer»).
- Підписаний документ: електронний підпис (платник і GMED; платник підписує першим, `signs_first`) або «Подтвердить подпись» з видом `cost_coverage_declaration` (новий `compliance_kind`, міграція `20261003110000`).
- Юридично документ — **Schuldbeitritt**: платник приєднується до боргу пацієнта за цим замовленням як солідарний боржник (§ 421 BGB), пацієнт залишається боржником; це **не** Bürgschaft (§ 766 BGB) і не звільняюча Schuldübernahme. Те саме виправлено в тексті Einzelauftrag (раніше: «Alle Vertragspflichten … gehen … über»).

## 4. Жорсткий шлюз: GMED підписує останнім

GMED (агенція) підтверджує замовлення або рамковий договір ліда лише тоді, коли:

1. клієнт підписав замовлення (`orders.signed_patient`);
2. декларація повна: `self` — походження коштів (і бенефіціар, якщо потрібно); третя особа — дані платника, інформування платника **і** підписана актуальна Kostenübernahmeerklärung.

Перевірки на сервері (`routes/lead_payer.rs`), відповідь `409 {"error":"payer_gate_blocked","reasons":[…]}`:

- `POST /orders/{id}/commercial-basis` з `signed_agency: true` (лише перехід false → true; `signed_patient` у тому ж запиті враховується);
- `POST /framework-contracts/{id}/status` → `signed` і створення договору ліда одразу зі статусом `signed`;
- `POST /documents/{id}/mark-signed` з видом `framework_contract` для документа ліда;
- `POST /signature-packages` / запит на підпис, у якому підписує `agency`, для `framework_contract` або `single_order` ліда: клієнт підписує першим у тому самому запиті (послідовність провайдера), тому перевіряється декларація; Kostenübernahmeerklärung у тому самому пакеті з підписантом `payer` зараховується, бо платник теж підписує до GMED.

Шлюз діє для неконвертованих лідів; замовлення пацієнтів без ліда не змінюються. Візард показує рядок «Клиент подписал ✓ → Плательщик подписал согласие ✓ → GMED подписывает» і причини блокування.

## 5. Готовність ліда і AML

- `load_lead_conversion_readiness`: перевірки `payer_declaration_complete` і `cost_assumption_signed` (крок `documents`, блокують конвертацію, не кваліфікацію) з причинами «Payer declaration is missing», «Source of funds is missing», «Third-party payer details are incomplete», «Payer is not informed about the processing of their data», «Cost assumption declaration is missing / names another payer / is not signed».
- Ризик країни для AML (FATF high-risk / blacklist) враховує країну проживання, **усі** громадянства ліда, а також країну проживання й громадянства третьої особи-платника — і на сервері (`enhanced_due_diligence_required`), і у візарді (`amlRiskForCountries`).

## 6. Права доступу

- Читання декларації: ролі з `leads.edit` (`CEO`, `Patient Manager`, `Sales`) і `CEO Assistant` (лише читання). `Concierge` (лише сервісна сітка лідів), `Billing`, перекладачі — 403.
- Зміна: ролі з `leads.edit` — як і відповіді AML-перевірки ліда. Синхронізація платника замовлення — наслідок декларації, окремого `invoices.payer` не потребує.
- Створення й позначка підпису Kostenübernahmeerklärung — як для інших документів ліда (`CEO`, `Patient Manager`).

## 7. Перевірка юриста (відкриті пункти)

1. Текст Kostenübernahmeerklärung (розділи 1–4, 6): Schuldbeitritt замість передачі обов'язків; посилання на конкретне замовлення; «sämtliche Kosten … in voller Höhe»; чи потрібна письмова форма / Widerrufsbelehrung, якщо платник — споживач (Fernabsatz, §§ 312 ff. BGB).
2. Текст Einzelauftrag з третьою особою: пацієнт залишається боржником; умова набрання чинності «erst mit Zugang der Kostenübernahmeerklärung».
3. Розділ 10 Kostenübernahmeerklärung: інформація за Art. 14 DSGVO для платника, дані якого отримано від пацієнта, і «Einverständnis» — чи потрібна згода взагалі, якщо підстави — Art. 6 Abs. 1 lit. b/c; контакт DPO; строки зберігання.
4. GwG: чи обов'язкове місце народження платника (§ 11 Abs. 4 Nr. 1 GwG) і чи потрібна ідентифікація платника за документом.
