# Посилені заходи належної перевірки (§ 15 GwG): формуляр і докази походження коштів

Стан: 2026-10-07. Це інженерний опис, не юридична консультація.

## Що це

Внутрішній документ GMED «Durchführung verstärkter Sorgfaltspflichten»
(шаблон `enhanced_due_diligence`, номер `AML-…`). Коли він обов'язковий,
вирішує правило власника 2026-10-07 (нижче); персонал може заповнити й
підписати його і добровільно. Формуляр заповнюється:

- у візарді ліда — панель «Verstärkte Sorgfaltspflichten (§ 15 GwG)»
  (`frontend/src/pages/leads/ui/lead-wizard.tsx`), дані зберігаються у
  `leads.wizard_state.aml_enhanced_due_diligence`;
- у генерації документа для пацієнта — `EnhancedDueDiligenceBindingFields`
  (`frontend/src/pages/documents/ui/enhanced-due-diligence-binding-fields.tsx`).

PDF будує `build_enhanced_due_diligence_pdf` у `routes/documents.rs`; дані
формуляра зберігаються у `documents.generated_bindings.aml_enhanced_due_diligence`.
Документ підписує лише представник GMED (політика підписантів `agency_only`).

## Коли посилена перевірка обов'язкова (правило власника 2026-10-07)

Для ліда (анкета за посиланням пацієнта) посилену перевірку вмикають **лише**:

| Ключ причини | Умова |
|---|---|
| `patient_residence_blacklist` | країна проживання пацієнта (`leads.country`) або країна звичайного перебування з кабінету (`lead_gwg_declarations.habitual_residence_country`) — у чорному списку |
| `patient_citizenship_blacklist` | будь-яке громадянство пацієнта (`leads.citizenships`, старе `wizard_state.registration_country`) — у чорному списку |
| `payer_residence_blacklist` | країна проживання третьої особи-платника з декларації (`lead_payer_declarations.country`) або з відповідей платника за власним посиланням (`lead_payer_statements.country`, `habitual_residence_country`; для організації — країна місцезнаходження) — у чорному списку |
| `payer_citizenship_blacklist` | громадянство платника-особи з декларації або з його відповідей — у чорному списку |
| `patient_sanctioned` | санкційна перевірка має **підтверджений** збіг для пацієнта (`sanctions_hits.status = 'confirmed'`, суб'єкт `lead_patient`, для пацієнта повторного звернення чи конвертованого ліда — `patient`) |
| `payer_sanctioned` | підтверджений збіг для платника (суб'єкт `lead_payer`) |

- **Чорний список** — лише країни FATF «call for action»: KP, IR, MM
  (`BLACK_LIST_COUNTRY_CODES` у [`lead_enhanced_check.rs`](../../crates/server/src/routes/lead_enhanced_check.rs);
  фронтенд має дзеркало `ENHANCED_CHECK_BLACKLIST_COUNTRY_CODES` у
  `frontend/src/pages/leads/model/enhanced-check.ts`, тест порівнює обидва).
  Довгий список країн підвищеного ризику (зокрема RU) і заблоковані країни
  санкційної політики (`blocked_countries`) перевірку **не** вмикають.
- Відкритий, ще не розглянутий можливий збіг — не тригер: у причинах він стоїть
  як `sanctions_review_pending`, `required` лишається `false`.
- PEP (відповідь персоналу чи ліда), країна довгого списку, готівка чи крипто й
  очікувана сума — лише жовта підказка для персоналу; для PEP: «PEP: nach § 15
  GwG ist in der Regel eine verstärkte Prüfung erforderlich – Entscheidung des
  Mitarbeiters». Законні представники неповнолітнього в правило не входять.
- Одна серверна функція `enhanced_check_triggers` (модуль
  `routes/lead_enhanced_check.rs`, один SQL-запит) рахує `{ required, reasons,
  countries }`. Її читають: готовність ліда (`enhanced_due_diligence_document_generated`
  / `…_signed` блокують конвертацію лише за `required`), рівень перевірки
  платника за посиланням (рівень 2 = `required`, тоді підтвердження походження
  коштів обов'язкове), лист ідентифікації GwG (5 a) і
  `patients.legal_status.aml_enhanced_due_diligence_required` при створенні
  проспекта й конвертації.
- `GET /leads/{id}/enhanced-check` → `{ "required": bool, "reasons": [...],
  "countries": [...] }` для ролей, що читають декларацію платника
  (`lead_payer::may_view`: `leads.edit` і `CEO Assistant`; інші — 403,
  невідомий лід — 404).
- Візард: обов'язковість формуляра (`amlRequired` у валідації кроку
  «Документы» і в розділі «Усиленная AML-проверка») бере відповідь сервера
  (перезавантажується після кожного оновлення ліда, збереження «Кто платит» і
  на `lead.portal_updated`), а ще не збережену країну чорного списку — одразу.
  Причини показуються як `tx(ru, de)` (`enhancedCheckReasonLabel`). Розділ
  «Усиленная AML-проверка» на кроці документів видно завжди: без тригера він
  каже «не обязательна» і пропонує добровільну перевірку. Нова країна
  чорного списку відкриває формуляр і ставить причину ризику; PEP чи країна
  довгого списку причину більше не ставлять і формуляр не відкривають.
- Рівень ризику в PDF (`riskTier`): `blacklist`, `sanctions` («Bestätigter
  Treffer auf einer Sanktionsliste»), `high_risk`, `pep` або `individual`
  («Einzelfallprüfung», добровільна перевірка без тригера).

## Докази походження коштів (з 2026-10-03)

§ 15 Abs. 4 Nr. 2 GwG вимагає заходів, якими визначається походження майна;
§ 8 GwG — фіксації й зберігання цих відомостей. Тому одразу під полем
«Herkunft der eingesetzten Vermögenswerte» є завантажувач «Nachweise zur
Herkunft der Vermögenswerte» (`AssetOriginEvidenceField`).

- Файли: PDF, JPG, PNG, до 25 МБ кожен, до 20 у формулярі (виписки з рахунку,
  договори купівлі-продажу, довідки про доходи тощо).
- Кожен файл одразу зберігається звичайним завантаженням
  (`POST /documents/upload`) як внутрішній документ того самого пацієнта або
  ліда: `art = aml_asset_origin_evidence`, `category = compliance_aml`,
  `visibility = internal`. Він проходить ту саму перевірку типу файла й
  антивірус, що й будь-яке завантаження.
- У формулярі зберігаються лише посилання:
  `assetOriginEvidence: [{ documentId, filename, uploadedOn }]`.
- Під час генерації сервер (`resolve_aml_asset_origin_evidence`) перевіряє, що
  кожен документ існує, не видалений, має тип `aml_asset_origin_evidence` і
  належить тому самому пацієнту або ліду; інакше — 422 «Asset origin evidence
  document not found». Назву файла й дату завантаження сервер бере зі
  збереженого документа, а не із запиту.
- У PDF під «Herkunft der eingesetzten Vermögenswerte» друкується перелік
  «Nachweise zur Herkunft der Vermögenswerte (in der Akte abgelegt)»:
  `1. Kontoauszug.pdf (hochgeladen am 03.10.2026)`.
- «Убрать» у формулярі лише знімає посилання; файл лишається в документах
  (видалення — звичайним шляхом документів, з причиною й аудитом).
- У візарді ліда такі файли не потрапляють до розділів «посвідчення особи /
  згоди» навіть якщо їхня назва схожа на паспорт.

## Чого немає

- Окремого строку зберігання для цих файлів: діє загальна політика документів
  (див. `docs/compliance/04_loeschkonzept.md`); п'ятирічний строк § 8 Abs. 4 GwG
  слід врахувати при наступному перегляді концепції видалення.
- Автоматичної перевірки змісту доказів — це рішення працівника й керівника,
  який погоджує формуляр.
- Правила 2026-10-07 для нового замовлення наявного пацієнта: майстер
  замовлення (`routes/order_intakes.rs`) досі вимагає для PEP перевірки
  `pep_review` і `pep_evidence` (підписаний `enhanced_due_diligence`). Правило
  власника сформульоване для анкети ліда; чи поширювати його на замовлення
  пацієнта — відкрите питання.
