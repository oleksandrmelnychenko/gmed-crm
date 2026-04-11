# Ядро вимог (Source of Truth)

> **Узгоджена ієрархія:** усі продуктові рішення, беклог, архітектура й реалізація **відштовхуються від оригінальних файлів клієнта** у цій папці. Файл `requirements/03_product-backlog_ua.md` **генерується** з аркуша `User Stories` (1 рядок Excel = 1 пункт; колонки *User Story* / *Beschreibung* збережені німецькою для трасованості): `python scripts/generate_product_backlog_from_excel.py`. Інші документи в `requirements/` та `backlog/` — робочі українські переклади / адаптації відповідних аркушів і PDF.

## 1. Авторитетні файли (німецькі оригінали)

| Файл | Тип | Що містить |
|------|-----|------------|
| [`Process Mapping (Kundenjourney allg.)(in Bearbeitung).pdf`](./Process%20Mapping%20(Kundenjourney%20allg.)(in%20Bearbeitung).pdf) | PDF (1 стор.) | Навскрізний клієнтський шлях: Lead/Kunde, Vertrieb, Compliance, Auftrag, KV, PM, Termine, Dolmetscher, Concierge, Abrechnung, Befunde/Arztbriefe, Follow-up (1w / 1m / 6m / 1m vor Paketablauf), ролі на діаграмі. |
| [`Allgemeine Anamnese (in Bearbeitung).pdf`](./Allgemeine%20Anamnese%20(in%20Bearbeitung).pdf) | PDF (1 стор.) | Flow першої анамнези: Case ID, маска, Vorerkrankungen, Operationen, Allergien, Impfstatus, Medikamente, Vegetativ, Symptome, Schmerz (NRS), Kardiologie-гілка тощо. |
| [`1 (Update 2) User Story Salesforce.xlsx`](./1%20(Update%202)%20User%20Story%20Salesforce.xlsx) | Excel | **User Stories** — функціональний scope за EPIC; **RBAC Matrix** — доступи по ролях; **KPIs** — показники та групи. |

### Структура Excel

| Аркуш | Рядків (орієнтовно) | Призначення |
|-------|---------------------|-------------|
| User Stories | 184 (включно з заголовком) | Колонки: EPIC, Rolle, User Story, Beschreibung, Security/Compliance, Priority (`1`–`4`). |
| RBAC Matrix | 11 | Ролі × домени доступу. |
| KPIs | 92 | Групи KPI та описи. |

### EPIC у Excel (1–24) → український каталог

Повний **рядок-у-рядок** scope з Excel — у [`requirements/03_product-backlog_ua.md`](./requirements/03_product-backlog_ua.md) (див. скрипт генерації вище). Відповідність номерів EPIC **зберігається**.

| № | Назва в Excel (оригінал) | Український заголовок у `03_product-backlog_ua.md` |
|---|---------------------------|---------------------------------------------------|
| 1 | Patientenakte | EPIC 1: Картка пацієнта |
| 2 | Partnerkliniken | EPIC 2: Партнерські клініки/провайдери |
| 3 | Zuweisung | EPIC 3: Призначення відповідальних |
| 4 | Termine | EPIC 4: Терміни (Appointments) |
| 5 | Dokumente | EPIC 5: Документи |
| 6 | eSignatur | EPIC 6: Е-підпис |
| 7 | Updates | EPIC 7: Оновлення медичних даних |
| 8 | Kommunikation | EPIC 8: Комунікація |
| 9 | Abrechnung | EPIC 9: Білінг/фінанси |
| 10 | Dolmetscher | EPIC 10: Перекладачі |
| 11 | Vertrieb | EPIC 11: Продажі |
| 12 | Vorlagen | EPIC 12: Шаблони |
| 13 | Freigaben | EPIC 13: Політики доступу і публікації |
| 14 | Sicherheit | EPIC 14: Безпека |
| 15 | Lernbereich | EPIC 15: Навчальний модуль (SOP) |
| 16 | VIP-Services | EPIC 16: VIP / concierge |
| 17 | Feedback | EPIC 17: Feedback |
| 18 | Workflows | EPIC 18: Workflows і чеклісти |
| 19 | Self-Service | EPIC 19: Self-service / портал |
| 20 | Risikoanalyse | EPIC 20: Ризик-аналіз |
| 21 | Terminmanagment und Kalendar | EPIC 21: Календар і терміни (орфографія як у файлі) |
| 22 | CEO | EPIC 22: CEO-модуль |
| 23 | Aufträge | EPIC 23: Замовлення (Orders) |
| 24 | AI | EPIC 24: AI |

## 2. Похідні канонічні документи (UA)

| Оригінал | Канонічний похідний документ |
|----------|------------------------------|
| Process Mapping PDF | [`requirements/01_process-mapping_ua.md`](./requirements/01_process-mapping_ua.md) — розгорнутий текстовий процес, gateway rules, бізнес-правила. |
| Anamnese PDF | [`requirements/02_anamnese-flow_ua.md`](./requirements/02_anamnese-flow_ua.md) — поля, секції, типи даних, суб-флоу. |
| Excel User Stories | [`requirements/03_product-backlog_ua.md`](./requirements/03_product-backlog_ua.md) |
| Excel RBAC Matrix | [`backlog/02_rbac-matrix_ua.md`](./backlog/02_rbac-matrix_ua.md) |
| Excel KPIs | [`backlog/03_kpi-catalog_ua.md`](./backlog/03_kpi-catalog_ua.md) |
| Усі джерела + NFR | [`requirements/04_non-functional-requirements_ua.md`](./requirements/04_non-functional-requirements_ua.md) (узгодження з іншими матеріалами проєкту) |
| Delivery / фази | [`backlog/01_mvp-backlog_ua.md`](./backlog/01_mvp-backlog_ua.md), [`backlog/04_implementation-tasks_ua.md`](./backlog/04_implementation-tasks_ua.md) |
| Архітектура | [`architecture/01_target-architecture_ua.md`](./architecture/01_target-architecture_ua.md) |

Регресійні матриці відносно scope: [`testing/source-workspace-regression-matrix.md`](./testing/source-workspace-regression-matrix.md), [`testing/source-documents-regression-matrix.md`](./testing/source-documents-regression-matrix.md), [`testing/source-billing-regression-matrix.md`](./testing/source-billing-regression-matrix.md).

Порядковий аудит **User Stories (Excel) ↔ `03_product-backlog_ua.md`:** [`testing/user-stories-excel-backlog-audit_ua.md`](./testing/user-stories-excel-backlog-audit_ua.md) (`python scripts/audit_excel_vs_backlog.py`). Після змін у Excel спочатку оновіть `03_product-backlog_ua.md` через `generate_product_backlog_from_excel.py`, потім перезапустіть аудит.

## 3. Правила узгодження

1. **Конфлікт формулювань:** пріоритет має **німецький оригінал** (PDF/XLSX). Український текст оновлюють, щоб відобразити оригінал.
2. **Конфлікт «схема vs текст»:** діаграма в PDF задає **послідовність і гілки**; `01_process-mapping_ua.md` може містити додаткову деталізацію для розробки, але **не суперечити** видимим крокам і рішенням на схемі.
3. **Пріоритети:** числові `Priority` у Excel трактуються як у [`03_product-backlog_ua.md`](./requirements/03_product-backlog_ua.md): `1` критично, `2` високо, `3` середньо, `4` нижче.
4. **Зміни scope:** оновлення проєкту починаються з правок **оригіналу клієнта** або з офіційно зафіксованої зміни до нього; потім синхронізуються UA-файли та при потребі код/тести.

## 4. Технічна примітка

Витяг тексту з PDF (OCR/layout) може давати зламані пробілослова; для спірних формулювань завжди звіряти **візуально PDF** або Excel-ячейку.

---

*Документ введено для єдиного «ядра» відліку: PDF + Excel у `docs/`.*
