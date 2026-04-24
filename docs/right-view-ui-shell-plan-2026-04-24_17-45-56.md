# План міграції Right View на UI Shell

Дата і час фіксації (Europe/Kyiv): 2026-04-24

## Підсумок аудиту
- Загалом знайдено 57 right-view у 37 файлах (`<SheetContent side=...>`).
- Повністю переведені на поточний патерн: 14/57.
- Частково переведені: 2 RV (у `frontend/src/pages/invoices.tsx`, detail-view).
- Не переведені (без `AdminSheetScaffold`): 26 RV.
- Конвертовані частково, але не доведені до shell-контейнера (`border-l border-border p-0`): 15 RV (admin-модулі).

## Де залишився борг
1. `frontend/src/pages/documents.tsx` — 3 RV, старий шаблон.
2. `frontend/src/pages/invoices.tsx` — detail RV частково старий (`SheetHeader/SheetTitle`).
3. `frontend/src/pages/patients/portal-invoices-page.tsx` + `frontend/src/pages/patients/ui/sheets/*` — старі примітиви RV.
4. `frontend/src/pages/appointments/ui/shared/workspace-primitives.tsx` + `frontend/src/pages/appointments/ui/sheets/*` — власні старі RV-обгортки.
5. `frontend/src/pages/admin-*.tsx` — функціонально мігровано, але треба технічна нормалізація shell-контейнера.

## Детальний план виконання

### Етап 1 (P0): Invoices detail right-view
- Файл: `frontend/src/pages/invoices.tsx`.
- Перевести detail-sheet на `AdminSheetScaffold`.
- Замінити ручний header/footer на `SheetActionsFooter`.
- Вирівняти всі контроли detail-форми на `inputClass/selectClass/textareaClass`.
- Результат: create + detail у `/invoices` повністю в одному патерні.

### Етап 2 (P0): Documents right-view
- Файл: `frontend/src/pages/documents.tsx`.
- Перевести всі 3 RV на `AdminSheetScaffold`.
- Уніфікувати footer через `SheetFormFooter`/`SheetActionsFooter`.
- Зняти локальні кастомні класи інпутів і селектів, перейти на shell-класи.
- Результат: `/documents` повністю відповідає UI shell-патерну.

### Етап 3 (P1): Appointments базові примітиви
- Файл: `frontend/src/pages/appointments/ui/shared/workspace-primitives.tsx`.
- Оновити `AppointmentEditorSheet` і `AppointmentPreviewSheet` до shell-структури.
- Додати технічну сумісність для існуючих споживачів (без лому API компонентів).
- Потім пройти:
  - `frontend/src/pages/appointments/ui/sheets/create-sheet-layer.tsx`
  - `frontend/src/pages/appointments/ui/sheets/mobile-detail-sheet.tsx`
  - `frontend/src/pages/appointments/ui/sheets/mobile-detail-sheet-content.tsx`
- Результат: пакетна міграція appointments RV через один базовий шар.

### Етап 4 (P1): Patients shared scaffold + пакетна міграція
- Додати спільний scaffold для patient-sheets (`patients/ui/shared`).
- Мігрувати у 2 хвилі:
  1. Ключові: `patient-list-detail-sheet.tsx`, `create-patient-sheet.tsx`, `patient-profile-editor-sheet.tsx`.
  2. Решта: appointment/card/notes/legal/vitals/risk/relation/financial/case-preview/legal-preview.
- Результат: всі patient right-view уніфіковані в одному стилі.

### Етап 5 (P1): Patient portal invoices
- Файл: `frontend/src/pages/patients/portal-invoices-page.tsx`.
- Перевести detail RV на той самий shell-патерн, узгодити з основним `/invoices`.
- Результат: без стилістичного розриву між staff і portal.

### Етап 6 (P2): Admin технічна нормалізація контейнерів
- Файли: `admin-access/activity/announcements/compliance/custom-fields/health/notifications/security/settings/users`.
- Для кожного RV привести контейнер `SheetContent` до `w-full border-l border-border p-0 sm:max-w-*`.
- Бізнес-логіку та структуру даних не змінювати.
- Результат: єдина геометрія та відступи shell-контейнерів у всіх admin RV.

### Етап 7 (QA gate)
- Для кожного зміненого RV:
  - desktop/mobile,
  - sticky footer + прокрутка body,
  - keyboard/focus/escape/close,
  - loading/error/saving/empty,
  - довгі локалізовані рядки,
  - `npm run -s typecheck` + `npx eslint <змінені файли>`.

## Definition of Done
1. `SheetContent side="right"` має shell-контейнер (`border-l border-border p-0`).
2. Використовується `AdminSheetScaffold`.
3. Footer — лише `SheetFormFooter` або `SheetActionsFooter`.
4. Поля — лише shell-класи (`inputClass/selectClass/textareaClass`).
5. Уніфіковані стані: loading/error/empty/saving.
6. Після етапу проходять typecheck + eslint для змінених файлів.
