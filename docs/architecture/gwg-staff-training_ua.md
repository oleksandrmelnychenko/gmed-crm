# GwG-Unterweisung співробітників (§ 6 Abs. 2 GwG) у «SOP и обучение»

Запит власника 2026-10-05. Основа — державний бланк «Risikomanagement:
Dokumentation interner Sicherungsmaßnahmen (§ 6 Abs. 2 GwG)». GMED не
заповнює державний PDF, а формує власний лист у фірмовому оформленні (той
самий юридичний макет, що й `gwg_identification` та `enhanced_due_diligence`,
[лист ідентифікації](gwg-identification-sheet_ua.md)). Лист документує на
кожного співробітника інструктаж щодо відмивання коштів (§ 6 Abs. 2 Nr. 6
GwG) і перевірку надійності (§ 6 Abs. 2 Nr. 5 GwG).

## Де що лежить

- **Запис** — у модулі SOP: таблиця `gwg_staff_trainings`, маршрути
  `crates/server/src/routes/sops_gwg_training.rs`, розділ «GwG-инструктаж
  (§ 6 Abs. 2 GwG)» на сторінці `/sops`
  (`frontend/src/pages/sops/ui/gwg-training-section.tsx`). Один запис на
  співробітника й інструктаж; повторний інструктаж — новий запис, історія
  зберігається. Тригер `gwg_staff_trainings_immutable` забороняє змінювати
  зміст і видаляти записи; змінюється лише посилання на підписаний скан.
- **PDF** — в особовій справі співробітника (Personalakte, [план](../personnel-files-plan-2026-09-30_ua.md)):
  категорія `gwg_unterweisung` («GwG Unterweisung», 5 років від кінця року
  інструктажу, як записи за § 8 Abs. 4 GwG; видалення вимкнене, доки строки не
  підтверджено), джерело `generated`. Назва файлу за правилами справи:
  `GwGUnterweisung_20261007_Muster_Anna.pdf`. Лист потрапляє в архів у тій
  самій транзакції, що й запис, тож запис без PDF або PDF без запису
  неможливі. Шаблон `gwg_staff_training`, номер документа `GWU-ДАТА-…` від id
  запису. До реєстру шаблонів документів пацієнта (`POST /documents/generate`)
  шаблон не входить: це не документ пацієнта.
- **Підписаний скан** — та сама справа, нова версія листа (`supersedes_id`,
  причина «Unterschriebene Fassung», назва `…_V2.pdf`). Запис отримує
  `signed_document_id`, `signed_at`, `signed_by`; статус «подписано». Новіший
  скан так само стає наступною версією; усі версії лишаються у справі.

## Лист

| Розділ бланка | Джерело |
|---|---|
| Name, Vorname; beschäftigt seit | особова справа (`employees`) |
| als, im Bereich | поля запису; за замовчуванням з останнього запису або з ролі прив'язаного акаунта (наприклад `interpreter` → «Dolmetscher/in», «Dolmetscherdienst») |
| 1. Unterrichtung: Datum; betriebsintern / durch Sonstige; in Form (mündlich, Informationsmaterial/Dokumentationsbogen, Sonstiges) | поля запису; тексти «weitere Angaben» обов'язкові там, де їх просить бланк |
| 2. Anweisungen (6 пунктів, § 10, § 15 з чотирма випадками, § 43, § 8 GwG) | коди `identify_partner`, `identify_acting_person`, `beneficial_owner`, `enhanced_due_diligence`, `suspicious_activity_report`, `record_keeping`; за замовчуванням усі шість |
| Ort, Datum; Unterschrift der/des Beschäftigten; Name in Druckbuchstaben | порожні лінії; ім'я друкується |
| 3. Zuverlässigkeit: a) langjährig / b) neu (Nachfrage nach Vorstrafen, Führungszeugnis, Sonstiges); «kontinuierlich zu überwachen» | поля запису; за замовчуванням a), якщо співробітник працює щонайменше 12 місяців, інакше b) з питанням про судимості |
| Unterschrift der Geschäftsleitung; Name in Druckbuchstaben | ім'я користувача, що зберіг запис (`management_name`) |

Абзац «Ausnahmeregelung Güterhändler» (готівка від 10 000 €) до GMED як
постачальника послуг не застосовується і в лист не друкується. Розділ 3
стоїть на сторінці 2, як у бланку: сторінку 1 підписує співробітник,
сторінку 2 — керівництво. Якщо довгі тексти «weitere Angaben» уже перенесли
підпис співробітника на сторінку 2, розділ 3 іде одразу за ним, а не з
нової сторінки.

## Статус і строк

- «не проводилось» — записів немає; «проведено, не подписано» — у
  найновішого запису немає скану; «подписано» — є.
- Інструктаж треба повторити, коли найновіший старший за 12 місяців
  (`next_due_on` = дата + 12 місяців; без записів — одразу). У таблиці
  попередження «Пора провести инструктаж», у заголовку — кількість.
- У таблиці лише співробітники, чия зайнятість не закінчилась
  (`employment_end` порожній або не в минулому). Співробітника без особової
  справи спершу заводять у розділі «Личные дела».

## Права

| Хто | Що |
|---|---|
| `CEO` (`personnel.view`) | бачить розділ: усі чинні співробітники, історія, PDF |
| `CEO` (`personnel.upload`) | проводить інструктаж (`POST /sops/gwg-training`) і завантажує підписаний скан (`POST /sops/gwg-training/{id}/signed-copy`) |
| Співробітник з прив'язаною особовою справою | бачить лише свої записи (`GET /sops/gwg-training/mine`) і відкриває свої листи через власну справу; нічого не змінює |
| Інші ролі | нічого (403); `Patient Manager`, хоч і веде SOP команди, записів не бачить: лист містить перевірку надійності й лежить в особовій справі, яку веде лише CEO (рішення Р1 справ) |

Сервер перевіряє права в кожному маршруті; приховування кнопок їх не
замінює. Перегляд і завантаження PDF пишуться в журнал справи
(`personnel_document_events`), як для будь-якого документа справи.

## Аудит

У тій самій транзакції, що й запис: `gwg_staff_training_created` (id
співробітника, id документа, шаблон і **лише назви** збережених полів, без
значень) та `personnel_document_archived`; для скану —
`gwg_staff_training_signed` і `personnel_document_archived`. Журнал справи
отримує `document_archived` / `document_version`.

## Підпис

Наразі — друк, підпис від руки й завантаження скану. Пакети електронного
підпису (Skribble) працюють із документами пацієнта й ліда (`documents`), а
не з архівом особових справ; електронний підпис для внутрішніх документів
співробітників — окреме рішення.

## Перевірка

- Rust: `crates/server/tests/gwg_staff_training_api.rs` (створення, перелік,
  PDF у справі, підписаний скан як версія 2, ролі, власний перегляд,
  незмінність, строк 12 місяців); юніт-тести листа в
  `crates/server/src/routes/documents.rs` (ключові тексти, дві сторінки, без
  «Güterhändler») і правил у `sops_gwg_training.rs`.
- Frontend: `frontend/src/pages/sops/model/gwg-training.test.ts`,
  `frontend/src/pages/sops/ui/gwg-training-section.test.tsx`, e2e з
  імітованим API `frontend/tests/e2e/sops-gwg-training.spec.ts`.
