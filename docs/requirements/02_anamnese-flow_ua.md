# Медичний intake та anamnesis

> **Джерело правди (графічне):** `docs/Allgemeine Anamnese (in Bearbeitung).pdf`. Цей файл — структурований переклад і нормалізація flow; при розбіжності з діаграмою пріоритет має PDF. Огляд ієрархії: `docs/00_source-of-truth_ua.md`.

## 1. Призначення документа

Цей документ описує:

- створення медичного `Case`;
- структуру форми анамнези;
- логіку заповнення секцій;
- вимоги до збереження, версійності та доступу.

## 2. Загальний процес intake

1. Для пацієнта створюється або відкривається активний медичний кейс.
2. Система генерує `Case ID`.
   - Якщо генерація `Case ID` не вдалась → необхідно розробити **Ersatzoption** (альтернативний варіант ідентифікації).
3. Відкривається форма anamnesis.
4. Користувач послідовно заповнює тематичні секції.
5. Кожна секція завершується перевіркою `Complete?`.
6. Після проходження базової anamnesis можуть запускатися спеціалізовані клінічні суб-флоу.

## 3. Обов'язкові поля верхнього рівня кейсу

| Поле | Тип | Опис |
|------|-----|------|
| `Case ID` | UUID, auto-generated | Системний ідентифікатор кейсу |
| `Hauptanfragegrund` | Freitext | Головний запит або причина звернення |
| `Aktuelle Anamnese` | Freitext, lang | Поточний розгорнутий анамнез |
| `Zuweiser` | Freitext | Направляючий контакт або лікар |
| `Case Notes` | Freitext | Службові примітки до кейсу |

## 4. Секції anamnesis

### 4.1 Попередні захворювання

Повторюваний блок (Add+). Кожен запис:

| Поле | Тип | Опис |
|------|-----|------|
| Erkrankung | Freitext, kurz | Назва або опис захворювання |
| Erstdiagnosedatum | Datum (MM.JJJJ) | Дата першого встановлення діагнозу |
| Notiz / Anmerkung | Freitext | Примітка |

### 4.2 Алергії та непереносимості

Повторюваний блок (Add+). Кожен запис:

| Поле | Тип | Опис |
|------|-----|------|
| Allergie | Freitext, kurz | Назва алергену або речовини |
| Reaktion / Notiz / Anmerkung | Freitext, mittel | Реакція та примітки |

### 4.3 Операції

Повторюваний блок (Add+). Кожен запис:

| Поле | Тип | Опис |
|------|-----|------|
| Datum | Datum | Дата операції |
| OP-Grund | Freitext | Причина операції |
| Arzt | Kontakt (FK → Contact) | Лікар, який оперував |
| Notiz / Anmerkung | Freitext | Примітка |

### 4.4 Вакцинація

| Поле | Тип | Опис |
|------|-----|------|
| Impfstatus | Freitext, mittel | Статус вакцинації у вільному тексті |

### 4.5 Медикаментозний анамнез

Повторюваний блок (Add+). Кожен запис:

| Поле | Тип | Опис |
|------|-----|------|
| Handelsname (Patient) | Freitext | Комерційна назва від пацієнта |
| Wirkstoff | Freitext | Діюча речовина |
| Dosis | Число + Einheitenauswahl | Доза з вибором одиниці виміру |
| Einnahmeschema | Freitext (формат: x-x-x-x, або b.B., або "siehe Anmerkung") | Схема прийому |
| Darreichungsform | Auswahl: Tabl., Lösung, Spray, Pen | Форма випуску (вибір зі списку) |
| Einheit | Auswahl+Freitext: Stück, I.E., ml, або вільний текст | Одиниця |
| Anmerkung / Hinweis | Freitext | Примітки та застереження |
| Grund (Diagnose oder Symptom) | Freitext | Показання — діагноз або симптом |
| Seit | Datum (MM.JJJJ) | Початок прийому |
| Verordnender Arzt | Kontakt (FK → Contact) | Лікар, який призначив |

### 4.6 Вегетативний анамнез

| Поле | Тип | Опис |
|------|-----|------|
| Appetit / Durst / Ernährungsbesonderheiten | Freitext | Апетит, спрага, харчові особливості |
| Körpergröße | Число (cm) | Зріст |
| Gewicht | Число (kg) | Вага |
| Gewichtsveränderungen / -verlauf | Freitext | Зміни ваги та динаміка |
| Grund | Freitext | Причина змін (якщо є) |

### 4.7 Поточні скарги та симптоми

Повторюваний блок (Add+). Кожен запис:

| Поле | Тип | Опис |
|------|-----|------|
| Aktuelle Beschwerden und Symptome | Freitext + Auswahl | Опис симптомів із вибором головних |
| Symptombeschreibung | Freitext | Детальний опис симптому |
| Fachrichtungsauswahl | Auswahl (Enum) | Вибір медичного напрямку (Kardiologie, Gastroenterologie тощо) — запускає спеціалізований суб-флоу |

### 4.8 Детальний pain block

Повторюваний блок (Add+). Кожен запис болю:

| Поле | Тип | Опис |
|------|-----|------|
| Wo? | Freitext | Локалізація болю |
| Seit wann? | Freitext | Час першого виникнення |
| Bestimmte Ursache / Provokation? | Freitext | Ймовірна причина: травма, Noxen, ОП, хвороба |
| Schmerzqualität | Freitext | Характер: brennend, stechend, ziehend тощо |
| Kontinuität | Freitext | Постійний? При навантаженні? При певних рухах/позиціях? |
| Entwicklung | Freitext | Динаміка з моменту появи: наростає / зменшується / без змін |
| Intensität NRS (aktuell) | Wert 1–10 | Числова шкала болю зараз |
| Intensität NRS (am Anfang) | Wert 1–10 | Числова шкала болю на початку |
| Dauer (am Anfang) | Freitext, Zeitangaben | Тривалість епізоду на початку |
| Dauer (aktuell) | Freitext, Zeitangaben | Тривалість епізоду зараз |
| Ausstrahlung / Projektion | Freitext | Іррадіація болю |
| Auftreten | Freitext | Тип початку: schleichend, plötzlich тощо |

### 4.9 Додаткові симптоми (не-больові)

Повторюваний блок (Add+). Кожен запис:

| Поле | Тип | Опис |
|------|-----|------|
| Symptombeschreibung | Freitext | Опис симптому або скарги |
| Fachrichtungsauswahl | Auswahl (Enum) | Прив'язка до медичного напрямку |

## 5. Логіка заповнення

Форма повинна підтримувати такі правила:

- кожна секція має власну перевірку `Complete?`;
- користувач може повертатись до попередніх секцій;
- перехід далі можливий лише після валідації обов'язкових полів секції;
- повторювані секції реалізуються як масиви записів через `Add (+)`;
- де це доречно, поля мають бути типізовані, а не лише текстові.

## 6. Спеціалізовані медичні суб-флоу

Після вибору медичного напряму із симптомів система повинна підтримувати окремі підфлоу.

На поточному етапі підтверджено:

- `Cardiology`

На майбутнє мають бути передбачені:

- `Gastroenterology`
- `Orthopedics`
- `Neurology`
- інші напрямки за потреби.

## 7. Типи полів — довідник для UI

Система використовує такі типи полів у формах анамнезу:

| Тип | Опис | UI widget |
|-----|------|-----------|
| `Freitext` | Вільний текст без обмеження довжини | textarea |
| `Freitext, kurz` | Короткий вільний текст (до ~100 символів) | text input |
| `Freitext, mittel` | Середній вільний текст (до ~500 символів) | textarea (3–5 рядків) |
| `Freitext, lang` | Довгий вільний текст | textarea (5+ рядків) |
| `Freitext, Zeitangaben` | Вільний текст для часових описів | text input |
| `Datum` | Повна дата | date picker |
| `Datum (MM.JJJJ)` | Місяць і рік | month picker |
| `Wert 1–10` | Числова шкала (NRS) | slider або number input (1–10) |
| `Число` | Числове значення (зріст, вага, доза) | number input |
| `Число + Einheitenauswahl` | Число з вибором одиниці | number input + dropdown |
| `Auswahl` | Вибір із фіксованого списку | dropdown / select |
| `Auswahl+Freitext` | Вибір зі списку або вільний ввід | combobox |
| `Kontakt (FK → Contact)` | Посилання на контакт у системі | autocomplete / lookup |
| `Add (+)` | Повторюваний блок — додавання нового запису | repeater / dynamic list |

## 8. Доменна модель верхнього рівня

### Case

Базова сутність `Case` повинна включати:

- системний `Case ID`;
- посилання на `Patient`;
- відповідального менеджера;
- статус кейсу;
- anamnesis sections;
- симптоми;
- pain records;
- пов'язані документи;
- audit trail змін.

### Структуровані підсутності

Потрібно підтримати окремі колекції:

- `Vorerkrankung[]`
- `Allergy[]`
- `Operation[]`
- `Medication[]`
- `Symptom[]`
- `PainRecord[]`
- `VegetativeAnamnese`

## 9. Правила збереження медичних даних

- Медичні дані не повинні фізично видалятися у звичайному робочому сценарії.
- Зміни мають зберігатися з історією версій.
- Повинно бути видно, хто, коли і що змінив.
- Медичні секції мають підпорядковуватись role-based і context-based access control.
- Потрібно підтримати зв'язок між anamnesis і подальшими clinical updates.

## 10. Наслідки для продукту та архітектури

Система повинна забезпечити:

- структуровану форму anamnesis;
- підтримку mixed input: text + typed fields + linked contacts;
- окрему модель для symptoms і pain assessment;
- розширення під specialty-specific flows;
- versioned clinical data model;
- повний audit trail по медичних змінах.
