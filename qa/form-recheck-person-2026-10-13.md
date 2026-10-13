# Повторна перевірка формуляра: особисті дані, документ і autosave

Дата: 2026-10-13. База: `37416f6b` плюс спільні незакомічені виправлення цього аудиту. Перевірка цього сектора охоплює **17 полів `PersonalDraft` і 25 полів `IdentificationDraft`**, файли та суміжні autosave представника/додаткових відповідей. Це не твердження про всі 113 полів формуляра; платники, отримувачі, згоди й життєвий цикл мають окремі звіти.

## Підтверджені дефекти та виправлення

| ID | Відтворення і вплив | Стан |
|---|---|---|
| PERSON-1 | Перший autosave імені повертає також нову адресу від співробітника. Наступне редагування телефону надсилало старе місто із локального draft та перезаписувало виправлення співробітника. | Виправлено: повернення сервера об'єднується із draft без втрати нового введення; queued patch обмежений полями, зміненими під час постановки в чергу. |
| PERSON-2 | Такий самий сценарій у `useIdentificationForm`: після відповіді з новим `former_names` наступний вибір каналу контакту відновлював старе `former_names`, навіть коли поле приховане. | Виправлено тим самим механізмом. Він також використовується ідентифікаційними полями додаткового кроку. |
| PERSON-3 | Непорожні ПІБ `--`, `...`, `’` або лише combining marks проходили frontend і серверну перевірку латиниці. | Додано вимогу хоча б однієї літери. Збережено діакритику, складені Unicode-послідовності, пробіли, дефіси й апострофи; порожній необов'язковий компонент ПІБ дозволений. Серверний unit розширено; запуск Rust координує root. |
| PERSON-4 | У формі представника відповідь першого запиту містить `city=Munich`; вже поставлений у чергу запит телефону надсилав `city=Berlin`. | Відтворено окремим browser regression, виправлено scoped patch та об'єднанням актуальної відповіді. |
| PERSON-5 | У додаткових відповідях після виправлення `sector` у відповіді сервера наступний queued `funds_description` відновлював старий сектор. | Відтворено окремим browser regression, виправлено у `FundsBlock`. |
| PERSON-6 | Пацієнт набирає occupation до завершення debounce і завантажує funds proof. Відповідь upload із новим server occupation безумовно підміняла його незбережене введення через effect синхронізації props. | Відтворено upload-while-typing regression; props-sync тепер зберігає dirty поля та синхронізує queued baseline. |

Початкові докази: `.tmp/release-audit/person-recheck-regressions.log` (PERSON-1/2: два очікувані падіння до виправлення), `.tmp/release-audit/person-recheck-siblings-before.log` (PERSON-4/5: два падіння з точним зайвим полем у payload). Це звичайні regression tests, не `expected-fail`.

Додаткова межа PERSON-1/2/4/5: два повільні запити послідовно повертають різні серверні виправлення міста. Саме rebasing React draft було недостатньо: застарілий `queuedDraftRef` класифікував перше серверне виправлення як нове введення пацієнта. `.tmp/release-audit/person-recheck-double-rebase-before.log` підтвердив проблему; остаточний fix синхронізує обидва draft і враховує captured edited fields проти baseline на старті запиту. PERSON-6 до виправлення: `.tmp/release-audit/person-recheck-upload-before.log`.

## Повна матриця особистих даних — 17/17

Джерело: `patient-lead/lead-request-model.ts::PERSONAL_FIELDS`, `draftFromPersonalData`, `personalDataPatch`. Сервер: `lead_portal_intake.rs::PersonalData::to_json`, `apply_personal_data_patch`, `update_my_personal_data`. У staff API дані повертаються як звичайні поля LeadDetail; `portal-intake.patient_fields` містить їх походження, а не дублює всі значення. Wizard: `lead-wizard.tsx::draftFromLead` та відповідні редаговані поля, realtime — `mergePatientUpdates`/`PORTAL_FIELD_BY_DRAFT_KEY`.

| Поле кабінету / API | Ключ draft візарда | Staff UI | Patientenformular PDF |
|---|---|---|---|
| `first_name` | `firstName` | Ім'я | Так |
| `middle_name` | `middleName` | Друге ім'я / по батькові | Так, у складі імені |
| `last_name` | `lastName` | Прізвище | Так |
| `date_of_birth` | `birthDate` | Дата народження | Так |
| `legal_sex` | `legalSex` | Стать згідно документів | Не включено у DTO PDF |
| `citizenships` | `citizenships`, `registrationCountry` | Громадянства | Так |
| `street_address` | `street` | Вулиця/будинок | Так |
| `zip_code` | `zip` | Індекс | Так |
| `city` | `city` | Місто | Так |
| `country` | `country` | Країна | Так |
| `phone` | `phone` | Телефон | Так |
| `primary_language` | `language` | Мова | Не включено у DTO PDF |
| `has_insurance` | `hasInsurance` | Наявність страхування | Не включено у DTO PDF |
| `insurance_type` | `insuranceType` | Вид страхування | Не включено у DTO PDF |
| `insurance_provider` | `insuranceProvider` | Страхова компанія | Не включено у DTO PDF |
| `insurance_number` | `insuranceNumber` | Номер поліса | Не включено у DTO PDF |
| `insurance_covers_germany` | `insuranceCoversGermany` | Покриття у Німеччині | Не включено у DTO PDF |

Відповідь «страхування немає» переводить тип у `self_pay` і очищає залежні реквізити на клієнті та сервері; це умовна логіка форми, не втрачений mapping. `mergePatientUpdates` не перезаписує поля, які співробітник зараз редагує. Новий `lead-form-person-parity.test.tsx` перевіряє повноту набору 17 ключів і збереження staff dirty fields.

## Повна матриця identification — 25/25

Джерело: `IDENTIFICATION_FIELDS`/`draftFromIdentification`/`identificationPatch`. API кабінету: `risk/cabinet.rs::cabinet_identification` об'єднує основні та додаткові відповіді. Staff API: `get_lead_portal_intake` бере їх із `staff_statements`; `normalizeIdentification` + `normalizeFollowUpAnswers` зберігають 24 немедичні відповіді. `request_reason` проходить окремо через `normalizeRequestReason`, відповідно до медичного доступу. Значення false також зберігається, не стає «не відповів».

| Поле | Staff UI / місце | PDF |
|---|---|---|
| `salutation` | Дані від пацієнта → Особа → Звертання | Так для mr/ms; явне `none` друкується без звертання |
| `former_names` | Особа → Прізвище при народженні | Так |
| `birth_place` | Особа → Місце народження | Так |
| `birth_country` | Особа → Країна народження | Так |
| `habitual_residence_country` | Особа → Країна звичайного перебування | Так |
| `contact_channels` | Особа → Канали зв'язку | Не включено у DTO PDF |
| `pep_self` | Юридичні питання → PEP | Так |
| `pep_related` | Юридичні питання → Зв'язок із PEP | Так |
| `sanctions_links` | Юридичні питання → Санкційні зв'язки | Так |
| `payment_background` | Економічний інтерес → Чому платить третя особа | Так |
| `relationship_since` | Додатково → З якого часу знайомі | Так |
| `residence_since` | Проживання → Відколи | Так |
| `other_residences` | Проживання → Інші місця | Так |
| `former_citizenships` | Проживання → Колишні громадянства | Так |
| `stay_reason` | Проживання → Підстава | Так |
| `stay_reason_details` | Проживання → Пояснення підстави | Так |
| `pep_office` | PEP → Посада | Так |
| `pep_country` | PEP → Країна | Так |
| `pep_period` | PEP → Період | Так |
| `pep_relationship` | PEP → Зв'язок | Так |
| `pep_wealth_origin` | PEP → Походження статків | Так |
| `sanctions_link_name` | Санкційні зв'язки → Особа/організація | Так |
| `sanctions_link_kind` | Санкційні зв'язки → Тип | Так |
| `sanctions_link_since_extent` | Санкційні зв'язки → Період/обсяг | Так |
| `request_reason` | Медичний крок → Зі слів пацієнта; окреме перенесення в staff concern | Навмисно виключено як медичні дані |

Новий parity unit перевіряє всі 24 ключі API та їх відображення у `LeadGwgStatements`, включно із закритими follow-up блоками та негативною відповіддю. Окремий unit підтверджує, що медична причина відображається в `LeadPatientConcern`, а не в GwG-блоці. Автоматичне заміщення тексту лікаря не додається: для непорожнього staff concern потрібна наявна дія перенесення/підтвердження.

## PDF: окрема зафіксована прогалина обсягу

`documents.rs::LeadSelfDisclosure`, `load_lead_self_disclosure` і renderer не включають **8 немедичних полів**: `legal_sex`, `primary_language`, п'ять полів страхування та `contact_channels`. У візарді всі вісім доступні. Це не втрата збережених даних і не frontend adapter bug. Обсяг юридичного PDF у цьому аудиті не розширювався: root окремо погодив лише зафіксувати цю невідповідність. Причина звернення та медичні файли виключені з Patientenformular навмисно, що прямо зазначено біля DTO.

## Документ і медичні файли

| Перевірена межа | Поточна реалізація / висновок |
|---|---|
| Кабінет вводить паспорт | Кабінет завантажує скан. Шість реквізитів (`id_document_type`, `id_document_number`, `id_issuing_authority`, `id_issuing_country`, `id_issued_on`, `id_valid_until`) вводить staff; вони проходять staff normalizer/UI/PDF. Не зараховані до 25 відповідей кабінету. |
| Формат/розмір | PDF/JPG/PNG, до25MiB у `IdentityDocumentSection` та спільній upload перевірці; backend перевіряє multipart, MIME/розмір і доступ. |
| Наявний staff паспорт | `identity_document_uploaded` враховує активний identity-document співробітника, прив'язаний до lead/prospect patient, і portal upload. |
| Видалення | `withdraw_my_lead_document` перевіряє uploader, row lock, reviewed/shared/signed/in-review/перенесений документ; документ, на якому вже внесена перевірена ідентифікація, захищений. |
| Ліміт файлів | UI використовує server `documents_used` або суму доступних категорій. `store_my_upload` повторно перевіряє ліміт під блокуванням lead. Існуючий integration regression конкурентного30-го upload збережений. |
| Медичні дані | `DocumentsStep` вимагає актуальної згоди на медичні дані; сервер має окремий guard. `request_reason` та медичні файли повертаються staff лише з медичним доступом. Актуальність/withdrawal згоди перевіряється в окремому consent-аудиті. |
| Staff відображення | Identity documents зберігають id, назву, дату і reviewed; медичні файли відображаються в медичному кроці та списку документів. Підтвердженого пропущеного поля в цьому секторі не знайдено. |

## Перевірки та межі доказів

### Додаткова межа: пакет файлів → перехід між кроками → відправлення

Підтверджено спільну гонку: кожен upload-loop ставив у чергу лише поточний файл. Після переходу на інший крок `submit` міг зайняти місце раніше за решту вибраних файлів. Відтворення на точній реалізації `useRequestQueue` давало порядок `upload-1 → submit → upload-2 → upload-3`. Локальний прапорець `uploading` не розв'язував межу, оскільки крок із ним демонтується під час навігації.

Виправлено чотири цикли: `DocumentsStep`, `IdentityDocumentSection` (включно з follow-up I), `RepresentativeUpload` (посвідчення/повноваження), `FileUploadField` (доказ коштів/зв'язку з платником). Увесь вибраний пакет займає одну операцію черги; API кожного файлу викликається без вкладеного `enqueue`. Ліміт розміру та окрема обробка помилки кожного файлу збережені. Форма платника має таке саме виправлення в окремому payer-аудиті.

Новий `lead-cabinet-upload-batch.spec.ts`: **7/7**, із затримкою першого й останнього файлу, переходом на інший крок та відправленням. Покрито медичні документи, паспорт пацієнта, паспорт представника, повноваження представника, доказ коштів, доказ зв'язку; сьомий сценарій перевіряє, що помилка середнього файлу не зупиняє наступний файл і не блокує чергу. Докази: `.tmp/release-audit/upload-batch-browser.log`; scoped ESLint успішний у `upload-batch-eslint.log`. Усі виклики mocked, Vite5197, proxy на закритий порт9.

- Базові7 focused test-файлів до виправлення: **89/89** (`person-recheck-units.log`).
- Після виправлень model/hint/autosave/representation/follow-up/parity: **93/93**,6 файлів (`person-recheck-final-units.log`).
- Targeted ESLint змінених TS/TSX і нового E2E: **успішно** (`person-recheck-eslint.log`).
- Перші4 concurrency/reload browser regression після виправлення: **4/4** (`person-recheck-regressions-fixed.log`).
- Прогін6 regressions + existing representation/follow-up: **22/22** (`person-recheck-siblings-fixed.log`).
- Фінальні concurrency regressions: **8/8** (`person-recheck-final-concurrency.log`). Повтор7 з них та16 existing representation/follow-up: **23/23** (`person-recheck-final-browser.log`); разом24 різні browser scenarios. Фінальний props-sync fix окремо перевірений восьмим upload-while-typing тестом.
- Rust unit і реальні API integration перевірки запускає root окремо; тут не заявляється новий backend runtime pass лише на основі читання коду.

Усі власні browser-тести працювали із синтетичними даними, повністю mocked `/api/v1/**`, закритим WebSocket та ізольованим Vite5197 з backend proxy `127.0.0.1:9`. DEV/PROD і користувацький localhost5173 не змінювались. Browser reload перевірено **після завершеного autosave**; примусове закриття вкладки до debounce/відповіді не оголошується гарантованим збереженням.

Root runtime verification: Rust `passport_spelling_is_required_only_for_submission` — PASS, `lead_identification_api` 9/9 і `lead_representatives_api` 6/6 — PASS на disposable PostgreSQL. Реальний browser/API round-trip зі збереженням, документом, надсиланням, reload і staff snapshot — PASS. Повний frontend unit suite 3281/3281 — PASS; сукупні докази див. [загальний звіт](form-recheck-2026-10-13.md).
