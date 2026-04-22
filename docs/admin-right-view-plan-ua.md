# План робіт: Right View для адмін-сторінок

Дата створення: 2026-04-22 16:24:57 +03:00 (Europe/Kiev)  
Відповідальний: Codex (GPT-5)

## Обмеження
- Таблиці не змінюємо.
- Працюємо лише з right view (sheet/dialog shell), формами, станами, UX-поведінкою.

## Базовий стандарт Right View (для всіх сторінок)
- [ ] Єдиний патерн: `Sheet + SheetContent side="right" + AdminSheetScaffold`.
- [ ] Єдина структура: `Header -> Body sections -> Sticky Footer`.
- [ ] Єдині стани: loading, error, success, saving/disabled.
- [ ] Єдиний UX-контроль: focus, Esc/close, unsaved-guard.
- [ ] Уніфікація ширини: 720px як дефолт, 860px тільки для складних форм.

## План по сторінках

### 1) Матрица доступа (`admin-access`)
- [x] Уніфікувати поточний right view під стандарт shell.
- [x] Розкласти контент на секції: `meta`, `permissions`, `audit note`.
- [x] Додати unsaved-guard при закритті.

### 2) Журнал активности (`admin-activity`)
- [x] Довести detail-panel до єдиного read-only шаблону.
- [x] Виділити блоки: `actor`, `action`, `entity`, `timestamp`, `payload`.
- [x] Уніфікувати fallback для порожніх значень (`-`).

### 3) Объявления (`admin-announcements`)
- [x] Закріпити right view для "Новое объявление" як стандартний шаблон.
- [x] Розділити форму на секції: `content`, `schedule`.
- [x] Уніфікувати footer дії та banner-стани.

### 4) DSGVO (`admin-compliance`)
- [x] Додати right view для consent/request операцій (створення/редагування).
- [x] Винести складні дії в окремі шторки: `grant/revoke`, `review`.
- [x] Додати блок `impact summary` перед submit.

### 5) Пользовательские поля (`admin-custom-fields`)
- [x] Мігрувати `Dialog` на right `Sheet`.
- [x] Вписати форму у `AdminSheetScaffold`.
- [x] Додати unsaved-guard та єдиний footer.

### 6) Состояние системы (`admin-health`)
- [x] Додати right view для `service/node details`.
- [x] Виділити секції: `status`, `uptime`, `last check`, `dependencies`, `diagnostics`.
- [x] Залишити read-only модель.

### 7) Уведомления (`admin-notifications`)
- [x] Уніфікувати create/detail right view до одного UX-стандарту.
- [x] Вирівняти footer-кнопки й режими дій.
- [x] Уніфікувати banner-поведінку в обох шторках.

### 8) Безопасность (`admin-security`)
- [x] Уніфікувати maintenance/IP шторки в єдиний патерн.
- [x] Додати `risk confirmation` для чутливих операцій.
- [x] Вирівняти валідацію, success/error стани.

### 9) Системные настройки (`admin-settings`)
- [x] Уніфікувати структуру секцій у wide right view.
- [x] Додати `changed fields summary` перед save.
- [x] Посилити unsaved-guard при переключенні груп.

### 10) Пользователи и роли (`admin-users`)
- [x] Мігрувати create/edit `Dialog` на right `Sheet`.
- [x] Розвести секції: `identity`, `access/roles`, `security flags`.
- [x] Уніфікувати UX create/edit і footer.

## Етапи реалізації
- [x] Етап 1: shared-інфраструктура (`useSheetDirtyGuard`, `SheetFormFooter`).
- [x] Етап 2: міграція `Dialog -> Sheet` (`admin-users`, `admin-custom-fields`).
- [x] Етап 3: нові right view (`admin-compliance`, `admin-health`).
- [x] Етап 4: уніфікація існуючих шторок (решта сторінок).
- [ ] Етап 5: QA (desktop/mobile, keyboard/focus, unsaved-close, submit/error).

## Лог виконання
- [x] 2026-04-22 16:24:57 +03:00 — план створено і зафіксовано в репозиторії.
- [x] 2026-04-22 16:31:24 +03:00 — реалізовано етапи 1/2: додано shared dirty-guard + footer, виконано міграцію `admin-users` і `admin-custom-fields` з `Dialog` на right `Sheet`.
- [x] 2026-04-22 16:35:10 +03:00 — додано read-only right view у `admin-health`; у `admin-compliance` перенесено consent/request форми в right sheet (залишились `review` + `impact summary`).
- [x] 2026-04-22 16:37:59 +03:00 — завершено `admin-compliance`: `review/execute` перенесені у right sheet, додано `impact summary`; етап 3 закрито.
- [x] 2026-04-22 16:39:01 +03:00 — старт етапу 4: уніфіковано футери right view на `admin-announcements` і create-flow `admin-notifications` через shared `SheetFormFooter`.
- [x] 2026-04-22 16:41:01 +03:00 — продовження етапу 4: додано shared `SheetActionsFooter` і переведено на нього футери шторок `admin-access`, `admin-activity`, `admin-security`, `admin-settings`, `admin-notifications` (detail).
- [x] 2026-04-22 16:42:14 +03:00 — додано `risk confirmation` у `admin-security` для активації maintenance mode; у `admin-settings` додано `changed fields summary` у right sheet перед збереженням.
- [x] 2026-04-22 16:45:03 +03:00 — у `admin-access` right sheet розкладено на `meta/permissions/audit note`; у `admin-settings` додано unsaved-guard при закритті шторки та перемиканні груп.
- [x] 2026-04-22 16:46:05 +03:00 — у `admin-activity` detail-sheet структуровано на блоки `actor/action/entity/timestamp/payload`; fallback для порожніх значень у payload уніфіковано на `-`.
- [x] 2026-04-22 16:47:20 +03:00 — завершено етап 4: додано guard закриття в `admin-access`; у `admin-settings` wide right view розкладено на окремі секції `Overview` і `Fields`.
- [x] 2026-04-22 16:52:03 +03:00 — QA-етап запущено: `lint`, `typecheck`, `unit tests` пройдено; таргетний e2e `admin-patient-pattern` пройдено; повний e2e має 6 нецільових фейлів (`patients-datatable`, `appointments-overview`) поза scope right-view.
