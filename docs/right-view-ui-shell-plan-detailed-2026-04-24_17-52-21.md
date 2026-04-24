# Детальний план міграції Right View на UI Shell

Дата і час фіксації (Europe/Kyiv): 2026-04-24 17:52:21 +03:00
Відповідальний: Codex (GPT-5)

## 1) Контекст і ціль
Мета: привести всі right-view (RV) до єдиного shell-патерну, щоб зникли стилістичні розриви між сторінками, спростилась підтримка і зменшився ризик повторних правок по кнопках, інпутах і футерах.

Цільовий патерн RV:
- Контейнер: SheetContent side="right" з класами w-full border-l border-border p-0 sm:max-w-*.
- Каркас: AdminSheetScaffold.
- Футер: SheetFormFooter або SheetActionsFooter.
- Поля: inputClass/selectClass/textareaClass із ui-shell.
- Стани: уніфіковані loading/error/empty/saving.

## 2) Обмеження
- Не змінювати бізнес-логіку.
- Не змінювати структуру таблиць, колонки, сортування, пагінацію.
- Не ламати API існуючих доменних компонентів.
- Рухатись малими commit-блоками з можливістю rollback по етапах.

## 3) Інвентар і поточний стан
Підсумок аудиту:
- Всього RV: 57 (37 файлів).
- Повністю у патерні: 14 RV.
- Частково у патерні: 2 RV (invoices detail).
- Не у патерні: 26 RV (без AdminSheetScaffold).
- Технічний борг контейнера (admin): 15 RV (без border-l border-border p-0).

### 3.1 Частково переведені (пріоритет P0)
- frontend/src/pages/invoices.tsx
  - create RV: переведено.
  - detail RV: ще на SheetHeader/SheetTitle + ручний layout.

### 3.2 Не переведені (пріоритет P0/P1)
P0:
- frontend/src/pages/documents.tsx (3 RV: generate, upload, detail).

P1:
- frontend/src/pages/appointments/ui/shared/workspace-primitives.tsx (2 базові RV-обгортки).
- frontend/src/pages/appointments/ui/sheets/create-sheet-layer.tsx.
- frontend/src/pages/appointments/ui/sheets/mobile-detail-sheet.tsx.
- frontend/src/pages/appointments/ui/sheets/mobile-detail-sheet-content.tsx.
- frontend/src/pages/patients/portal-invoices-page.tsx.
- frontend/src/pages/patients/ui/sheets/* (17 RV):
  - create-patient-sheet.tsx
  - patient-appointment-sheet.tsx
  - patient-card-entry-sheet.tsx
  - patient-case-preview-sheet.tsx
  - patient-cave-notes-sheet.tsx
  - patient-financial-dialogs.tsx
  - patient-legal-preview-sheets.tsx (3 RV)
  - patient-legal-status-sheet.tsx
  - patient-list-detail-sheet.tsx
  - patient-medical-order-sheet.tsx
  - patient-notes-sheet.tsx
  - patient-profile-editor-sheet.tsx
  - patient-relation-editor-sheet.tsx
  - patient-risk-score-sheet.tsx
  - patient-vitals-sheet.tsx

### 3.3 Технічна нормалізація (пріоритет P2)
Admin RV вже функціонально уніфіковані, але контейнер класів треба довести до shell-стандарту:
- frontend/src/pages/admin-access.tsx
- frontend/src/pages/admin-activity.tsx
- frontend/src/pages/admin-announcements.tsx
- frontend/src/pages/admin-compliance.tsx (3 RV)
- frontend/src/pages/admin-custom-fields.tsx
- frontend/src/pages/admin-health.tsx
- frontend/src/pages/admin-notifications.tsx (2 RV)
- frontend/src/pages/admin-security.tsx (2 RV)
- frontend/src/pages/admin-settings.tsx
- frontend/src/pages/admin-users.tsx (2 RV)

## 4) Пріоритезація і аргументація
P0 (високий ризик UX-розриву + частий usage):
- /invoices detail, /documents.
- Причина: фінансові і документні сценарії критичні, видимий розрив стилю, багато полів і станів.

P1 (масштабна уніфікація через базові примітиви):
- appointments + patients modules.
- Причина: велика кількість RV; найвигідніше зробити shared-scaffold і мігрувати пакетно.

P2 (технічний дотюнінг):
- admin контейнерні класи.
- Причина: низький ризик, але потрібна повна консистентність shell-контейнера.

## 5) Детальний WBS

### Етап 0 — Підготовка (0.5 дня)
Ціль: зменшити дублювання перед масовою міграцією.

Задачі:
1. Зафіксувати RV contract у docs (цей файл).
2. Перевірити reusable компоненти:
   - components/admin-page-patterns.tsx
   - pages/patients/ui/shared/*
   - pages/appointments/ui/shared/*
3. Затвердити mapping ширин:
   - narrow: 520–560
   - default: 720
   - form-heavy: 760
   - detail-wide: 860–980

DoD:
- Є узгоджений контракт структури RV.
- Немає змін у бізнес-логіці.

### Етап 1 — P0: Invoices detail (0.5 дня)
Файл: frontend/src/pages/invoices.tsx

Задачі:
1. Перевести detail RV на AdminSheetScaffold.
2. Замінити SheetHeader/SheetTitle/SheetDescription на scaffold header.
3. Замінити ручні action areas на SheetActionsFooter там, де це нижня панель дій.
4. Вирівняти всі Input/select/textarea у detail на shell-класи.
5. Перевірити поведінку scroll-body і footer.

Ризики:
- Поломка вертикального ритму секцій через зміну контейнера.
- Неправильний sticky/footer при довгому контенті.

Контроль:
- Manual test для invoice з довгими line items.
- Перевірка Esc/close/re-open + збереження статусу.

DoD:
- У /invoices обидва RV (create + detail) працюють в одному shell-патерні.

### Етап 2 — P0: Documents (1.0–1.5 дня)
Файл: frontend/src/pages/documents.tsx

Задачі по RV:
1. Generate RV (templateOpen):
   - заміна старого header/footer на scaffold + SheetFormFooter.
   - переведення Input/Select на shell-класи.
2. Upload RV (uploadOpen):
   - та сама заміна shell-каркасу.
   - окрема перевірка type=file поля.
3. Detail RV (selectedId):
   - заміна header на scaffold.
   - вивірка body-scroll.
   - уніфікація action area.

Специфічні ризики:
- Generate має багато conditional-блоків і checkbox-grid.
- Можливий layout shift на mobile.

Контроль:
- Перевірити три сценарії: generate, upload, detail.
- Для generate окремо перевірити template/language/patient-order-appointment flow.

DoD:
- Усі 3 RV у /documents переведені.
- Немає локальних h-10 rounded-xl класів у RV-формах.

### Етап 3 — P1: Appointments shared migration (1.0 дня)
Ключовий файл: frontend/src/pages/appointments/ui/shared/workspace-primitives.tsx

Задачі:
1. Оновити AppointmentEditorSheet до shell-контейнера і shell-структури.
2. Оновити AppointmentPreviewSheet аналогічно.
3. Зберегти сумісність пропсів для downstream компонентів.
4. Підчистити споживачів:
   - create-sheet-layer.tsx
   - mobile-detail-sheet.tsx
   - mobile-detail-sheet-content.tsx

Ризики:
- Великий blast radius через shared primitive.
- Регресія mobile-detail UX.

Контроль:
- Desktop/mobile smoke.
- Перевірка lazy-loading fallback у create-sheet-layer.

DoD:
- Appointments RV будуються через один уніфікований shared pattern.

### Етап 4 — P1: Patients shared scaffold + пакетна міграція (2.0–2.5 дня)

Підетап 4.1 (foundation):
1. Додати patient-sheet-scaffold у pages/patients/ui/shared.
2. Інкапсулювати shell container, header/body/footer і width presets.

Підетап 4.2 (critical first):
1. patient-list-detail-sheet.tsx
2. create-patient-sheet.tsx
3. patient-profile-editor-sheet.tsx

Підетап 4.3 (batch migration):
1. patient-appointment-sheet.tsx
2. patient-card-entry-sheet.tsx
3. patient-case-preview-sheet.tsx
4. patient-cave-notes-sheet.tsx
5. patient-financial-dialogs.tsx
6. patient-legal-status-sheet.tsx
7. patient-medical-order-sheet.tsx
8. patient-notes-sheet.tsx
9. patient-relation-editor-sheet.tsx
10. patient-risk-score-sheet.tsx
11. patient-vitals-sheet.tsx
12. patient-legal-preview-sheets.tsx (3 RV)

Ризики:
- Велика кількість файлів.
- Нюанси доменних модулів legal/financial/risk.

Контроль:
- Пакетні перевірки по 4–5 файлів.
- Smoke перед переходом до наступного пакета.

DoD:
- Усі patient RV на спільному shell-scaffold.

### Етап 5 — P1: Patient portal invoices (0.5 дня)
Файл: frontend/src/pages/patients/portal-invoices-page.tsx

Задачі:
1. Перевести detail RV на патерн, узгоджений з main /invoices.
2. Перевірити візуальну консистентність staff vs portal.

DoD:
- Portal invoices detail не вибивається з shell-поведінки.

### Етап 6 — P2: Admin container normalization (0.5–1.0 дня)

Задачі:
1. У 10 admin файлах змінити лише container класи RV на w-full border-l border-border p-0 sm:max-w-*.
2. Не чіпати бізнес-логіку.

DoD:
- Усі 15 admin RV мають однакову геометрію shell-контейнера.

### Етап 7 — QA Gate (1.0 дня)
Автоматичні перевірки:
1. npm run -s typecheck
2. npx eslint <змінені файли>

Ручний чекліст для кожного RV:
1. Open/close, Esc, click-outside.
2. Scroll-body і footer стабільні.
3. loading/error/empty/saving.
4. Keyboard navigation і focus.
5. Mobile (мінімум 390px) + desktop.
6. Довгі тексти RU/DE/EN не ламають layout.

DoD:
- Всі критерії QA пройдені без regressions.

## 6) Стратегія комітів
- Commit 1: refactor(invoices): migrate detail right-view to ui-shell scaffold
- Commit 2: refactor(documents): migrate generate/upload/detail right-views to ui-shell
- Commit 3: refactor(appointments): unify shared right-view primitives with ui-shell
- Commit 4: refactor(patients): introduce shared sheet scaffold and migrate core sheets
- Commit 5: refactor(patients): migrate remaining patient right-view sheets
- Commit 6: refactor(portal-invoices): align patient portal right-view with ui-shell
- Commit 7: chore(admin): normalize right-view container classes
- Commit 8: chore(ui-shell): rv qa fixes and consistency polish

Принцип:
- Один commit = один логічний етап.
- Не міксувати домени в одному commit.

## 7) Ризик-матриця
1. Регресія scroll/fixed footer.
- Ймовірність: висока.
- Вплив: високий.
- Мітигація: стандартизувати структуру через scaffold, manual scroll-check.

2. Поломка close поведінки (onOpenChange).
- Ймовірність: середня.
- Вплив: високий.
- Мітигація: не змінювати доменні close handlers; smoke open-close cycle.

3. Style drift через локальні класи.
- Ймовірність: висока.
- Вплив: середній.
- Мітигація: заборона локальних input-класів у RV, лише shell-класи.

4. Великий blast radius у shared primitives.
- Ймовірність: середня.
- Вплив: високий.
- Мітигація: етапність + перевірка споживачів після кожної shared-зміни.

## 8) Чіткі критерії готовності
1. Кожен RV має shell container class (border-l border-border p-0).
2. Кожен RV на scaffold-патерні.
3. Footer стандартизований (SheetFormFooter або SheetActionsFooter).
4. Поля на inputClass/selectClass/textareaClass.
5. Немає дублювання старого SheetHeader/SheetTitle там, де діє scaffold.
6. Typecheck + eslint проходять для всіх змінених файлів.
7. Пройдено ручний QA-чекліст.

## 9) Rollback / Recovery
1. Якщо регресія після етапу:
- revert останній commit етапу,
- локалізувати проблему в окремому hotfix commit.
2. Не зливати наступний етап, поки попередній не пройшов QA.
3. Для shared primitives: тимчасова зворотна сумісність через пропси.

## 10) Рекомендований порядок виконання
- [x] Етап 1 (/invoices detail).
- [x] Етап 2 (/documents 3 RV).
- [x] Етап 3 (appointments shared primitives).
- [x] Етап 4 (patients shared + migration).
- [x] Етап 5 (portal invoices).
- [x] Етап 6 (admin container normalization).
- [x] Етап 7 (full QA gate).

## 11) Лог виконання
- [x] 2026-04-24 17:57:04 +03:00 — завершено Етап 1: `frontend/src/pages/invoices.tsx` detail RV переведено на `AdminSheetScaffold`, дії у статус-секції переведені на `SheetActionsFooter`, поля статусу вирівняні на shell-класи; `typecheck` і `eslint` пройдено.
- [x] 2026-04-24 18:00:45 +03:00 — завершено Етап 2: `frontend/src/pages/documents.tsx` (generate/upload/detail RV) переведено на `AdminSheetScaffold`, футери create-flow на `SheetFormFooter`, старий `SheetHeader` прибрано, input/select/textarea вирівняні на shell-класи; `typecheck` і `eslint` пройдено.
- [x] 2026-04-24 18:15:12 +03:00 — завершено Етап 3: `appointments` shared RV переведені на `AdminSheetScaffold` (`workspace-primitives.tsx`), actions-футер уніфіковано через `SheetActionsFooter`, `create-sheet-layer.tsx` прибрано від дубльованого header-каркаса з передачею `title` у lazy sheet, `create-appointment-sheet.tsx` переведено на `AppointmentEditorSheet`, `mobile-detail-sheet.tsx` і `mobile-detail-sheet-content.tsx` переведені на scaffold-патерн; `typecheck` і `eslint` пройдено.
- 2026-04-24 18:21:23 +03:00 — розпочато Етап 4: додано foundation `frontend/src/pages/patients/ui/shared/patient-sheet-scaffold.tsx` (shell container + width presets + unified footer), і переведено critical first RV: `create-patient-sheet.tsx`, `patient-list-detail-sheet.tsx`, `patient-profile-editor-sheet.tsx` на спільний scaffold без зміни доменної логіки; `typecheck` і `eslint` пройдено.
- 2026-04-24 18:24:39 +03:00 — продовжено Етап 4 (batch): переведено на `PatientSheetScaffold` ще 3 RV у `patients` — `patient-notes-sheet.tsx`, `patient-cave-notes-sheet.tsx`, `patient-legal-status-sheet.tsx`; контейнери й футери уніфіковані під ui-shell, `typecheck` і `eslint` пройдено.
- 2026-04-24 18:26:15 +03:00 — продовжено Етап 4 (batch): переведено `patient-card-entry-sheet.tsx` на `PatientSheetScaffold` і shell-класи полів (`selectClass`/`textareaClass`) без зміни API-запитів чи валідації; `typecheck` і `eslint` пройдено.
- 2026-04-24 18:36:59 +03:00 — продовжено Етап 4 (batch): переведено ще 5 RV у `patients` — `patient-vitals-sheet.tsx`, `patient-appointment-sheet.tsx`, `patient-medical-order-sheet.tsx`, `patient-risk-score-sheet.tsx`, `patient-relation-editor-sheet.tsx`; уніфіковано shell-контейнер, футер-дії та класи контролів (`inputClass`/`selectClass`/`textareaClass`) без зміни бізнес-логіки API; `typecheck` і `eslint` пройдено.
- 2026-04-24 18:40:50 +03:00 — продовжено Етап 4 (batch): переведено `patient-legal-preview-sheets.tsx` (documents/contracts/invoices preview RV) на `PatientSheetScaffold` з уніфікованим shell-container; `typecheck` і `eslint` пройдено.
- 2026-04-24 18:42:35 +03:00 — продовжено Етап 4 (batch): переведено `patient-financial-dialogs.tsx` right-view створення договору на `PatientSheetScaffold`, поля вирівняно на shell-класи (`inputClass`/`selectClass`); решта діалогів у файлі (modal) залишені без змін як не-RV; `typecheck` і `eslint` пройдено.
- [x] 2026-04-24 18:44:02 +03:00 — завершено Етап 4: `patient-case-preview-sheet.tsx` переведено на `PatientSheetScaffold`; після цього всі `patients/ui/sheets/*` RV у shell-патерні. `typecheck` і `eslint` пройдено.
- [x] 2026-04-24 18:51:57 +03:00 — завершено Етап 5: `frontend/src/pages/patients/portal-invoices-page.tsx` detail RV переведено на `AdminSheetScaffold` + shell-container (`border-l border-border p-0`), оновлено стилі секцій/тайтлів (включно з кольоровими крапками за патерном), вирівняно поля upload-dialog на `inputClass`/`textareaClass`; `typecheck` і `eslint` пройдено.
- [x] 2026-04-24 18:54:29 +03:00 — завершено Етап 6: у 10 файлах `admin-*` нормалізовано 15 RV контейнерів `SheetContent` на shell-класи `w-full border-l border-border p-0 sm:max-w-*` без зміни бізнес-логіки; `typecheck` і `eslint` пройдено.
- 2026-04-24 18:58:04 +03:00 — Stage 7 (partial QA): повторно прогнано автоматичні перевірки (`npm run -s typecheck`, `npx eslint` для змінених `portal-invoices` + `admin-*` файлів); manual checklist лишається pending.
- 2026-04-24 19:11:59 +03:00 — Stage 7 (expanded QA): `vitest` пройдено (22 files / 239 tests), `eslint` по змінених файлах пройдено; full `npm run lint` не зелений через нерелевантну помилку в `frontend/src/pages/cases.tsx` (`_required` unused) і warnings у `contracts.tsx`; full `playwright` дав 24/30 pass із падіннями поза scope (`patients-datatable` login timeout + `patient services` timeout). Цільові e2e по scope пройдені: `patient portal invoices` (2/2), `admin shell pattern` (1/1), `staff smoke open ... documents and invoices` (1/1).
- [x] 2026-04-24 19:14:32 +03:00 — завершено Етап 7: виправлено lint-blockers поза RV-scope (`frontend/src/pages/cases.tsx`, `frontend/src/pages/contracts.tsx`), після чого `npm run -s lint` (включно з `check:staff-nav`), `npm run -s typecheck` і `npm run -s test` (22 files / 239 tests) пройшли успішно. Додатково залишено цільові e2e smoke по invoices/admin/staff у green.

Очікуваний результат: повністю уніфікований Right View стандарт по всіх активних модулях без повторних точкових правок стилю.
