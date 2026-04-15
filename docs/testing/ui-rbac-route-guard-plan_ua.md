# План: UI + маршрути + ролі на 100% (single source of truth)

> Статус: **route-guard current-state + жорсткий регрес-гейт** (2026-04-15): `App.tsx` staff routes всі сидять під `AppLayout`, `layout.tsx` уже блокує staff deep-link через `canAccessStaffRoute`, `nav-panel` будується з тієї ж shared route metadata, patient portal whitelist теж сидить у тому ж access layer, `check-staff-spa-navigation.mjs` забороняє **будь-який** `navigate(` у `src` поза allowlist і **`<NavLink`** поза `nav-panel`; ESLint ті самі імпорт-обмеження на **`src/components`** (крім shell/ui); Vitest — інтеграційний запуск скрипта + unit на `stripTsCommentsForScan`; live Playwright додатково перевіряє forbidden deep-link normalization для staff і patient shell, включно з high-risk клітинками `sales -> /documents`, `sales -> /contracts`, `concierge -> /invoices`, `billing -> /cases`, `it_admin -> /patients|/cases|/reports|/documents`. Основного незакритого RBAC хвоста тут уже не лишилось.
> Контекст: **login** — `redirectTo` без staff-таблиці.

## 1. Визначення «100% готово»

1. **Одне джерело правди** для shell routes: таблиця/metadata «маршрут → дозволені ролі» (або предикат), з якої будуються **навігація** і **route guard**.
2. Усі маршрути з `App.tsx` під staff-оболонкою або проходять guard, або явно винесені в **винятки** з коментарем і посиланням на RBAC / API.
3. **Пацієнтський** доступ: whitelist порталу живе в тому ж access layer, без дублювання списку маршрутів у `layout.tsx` і `nav-panel.tsx`.
4. **Регресія**: автотести перевіряють пари `(роль, шлях)` проти таблиці; заборонений deep-link дає **однакову** поведінку (редірект або сторінка «немає доступу» — один варіант на продукт).
5. **Бекенд** залишається канонічним для даних; UI guard не замінює `403` на API, а **вирівнює** UX і зменшує поверхню для плутанини.

## 2. Поточний розрив (короткий аудит)

| Місце | Проблема |
|--------|-----------|
| `frontend/src/components/nav-panel.tsx` | Вже сидить на shared staff route metadata; лишився тільки контроль не роз'їхатись із route-table при нових екранах. |
| `frontend/src/App.tsx` | Staff-маршрути вже сидять під `AppLayout`; залишився лише контроль не плодити винятки. |
| Окремі сторінки | Локальні defence-in-depth перевірки лишаються, але більше не є головним RBAC-шаром. |
| `frontend/src/components/layout.tsx` | Staff + patient guard уже централізовані; forbidden deep-link normalization тепер покритий live Playwright. |

## 3. Фази робіт

### Фаза A — Інвентаризація

- Виписати всі staff-маршрути з `App.tsx` (включно з `/:id` та адмін-префіксом `/admin/*`).
- Для кожного маршруту зафіксувати **дозволені ролі** з:
  - [02_rbac-matrix_ua.md](../backlog/02_rbac-matrix_ua.md)
  - [04_rbac-e2e-test-plan_ua.md](04_rbac-e2e-test-plan_ua.md)
  - фактичних `crates/server/tests/*_api.rs` (де вже зацементовано deny/allow).
- Явно зафіксувати винятки: окремий `/admin` hub поки не змонтований; admin-секція в навігації рендериться лише якщо роль має хоча б один видимий admin route.

**Артефакт:** таблиця маршрутів (можна тимчасово CSV); ціль — перенести в код у фазі B.

### Фаза B — Single source of truth (ядро фронту)

- Новий модуль, наприклад `frontend/src/lib/staff-route-access.ts`:
  - константи маршрутів: `{ pattern, match: 'exact' \| 'prefix', roles: readonly StaffRole[] }`;
  - `canAccessStaffRoute(role: string, pathname: string): boolean`;
  - опційно `getDefaultRedirectForRole(role)` для після logout / denied.
- **Правило:** `nav-panel` будує видимі пункти **з цієї таблиці** (або генерує `NavItem` з неї), щоб не підтримувати два незалежні списки.

### Фаза C — Route guard (закриття deep link)

- Компонент на кшталт `StaffRouteGuard` навколо вмісту `AppLayout` (або окремий layout-route):
  - `patient` — використовувати той самий access layer, без локального `isPatientPortalPath`;
  - staff: якщо `!canAccessStaffRoute(role, pathname)` → **`Navigate`** на узгоджений безпечний шлях (наприклад `/`) **або** окрема сторінка `/access-denied` — **один** варіант на весь продукт.
- Динамічні шляхи: префікси `/patients/`, `/providers/`, `/orders/` тощо — узгодити з `pattern` типу `prefix`.

### Фаза D — Вирівнювання сторінок

- Сторінки з власною заглушкою «немає доступу»: або прибрати дубль після guard, або залишити як **defence in depth** — задокументувати в коді.
- **Зроблено:** див. статус вище; для нових екранів — завжди `useStaffNavigate().staffGo` замість «голого» `navigate` на внутрішні SPA-URL; для `Link` — або `canStaffPath` + умова, або `staffTo` (якщо прийнятно вести на `/` при відмові).

### Фаза E — Тести

1. **Vitest:** набір канонічних шляхів × усі staff-ролі узгоджується з `peekStaffRouteRule` + `canAccessStaffRoute`; окремо `staffHrefIfAllowed`. Опційно: тест «кожен пункт меню ⊆ дозволені маршрути для ролі».
2. **Playwright (опційно live):** smoke на high-risk ролях — прямий захід на заборонений URL → очікуваний редірект/denied. Current-state baseline уже включає `patient_manager -> /admin/settings`, `ceo_assistant -> /admin/users`, `billing -> /appointments`, `sales -> /documents`, `sales -> /contracts`, `concierge -> /invoices`, `billing -> /cases`, `it_admin -> /patients|/cases|/reports|/documents`, `interpreter -> /reports`, `patient -> /patients`.
3. У шапці модуля `staff-route-access.ts` — посилання на цей документ і на `02_rbac-matrix_ua.md`.
4. **Автоматичний регрес-гейт (макс.):** `frontend/scripts/check-staff-spa-navigation.mjs` + `npm run check:staff-nav` (у `npm run lint`): у сканованих файлах **заборонено будь-який** `navigate(` (лише allowlist: login, `use-staff-navigate`, topbar, layout, nav-panel, staff-link, patient-portal); **заборонено** `<NavLink` поза `nav-panel.tsx`; плюс перевірки «голого» `<Link to=/` та `<Navigate to=/`. Vitest: `staff-navigation-guard.integration.test.ts` + `staff-spa-navigation-script.unit.test.ts` (імпорт `stripTsCommentsForScan` з того ж `.mjs`). ESLint `no-restricted-imports` для **`src/pages/**/*.tsx`** і **`src/components/**/*.tsx`** (крім login, patient-portal, `staff-link`, `topbar`, `nav-panel`, `layout`, `components/ui/**`) — заборона `useNavigate` та `Link` з `react-router-dom`.

### Фаза F — Узгодження з бекендом

- Для кожного спірного маршруту (reports, forecasting, admin): якщо UI дозволяє, а API стабільно `403` — виправити **таблицю UI** або бекенд (за продуктовим рішенням).
- Після змін — `cargo test -p gmed-server --tests` і відповідні frontend тести.

## 4. Критерії приймання

- [x] Немає staff-маршрута в `App.tsx`, який обходить guard без явного винятку в коді + коментар.
- [x] `nav-panel` не містить пунктів, що не виводяться з таблиці доступу (staff nav тепер виводиться з shared route metadata).
- [x] Vitest покриває репрезентативний набір шляхів × усі staff-ролі (узгоджено з правилами через `peekStaffRouteRule`).
- [x] CI/лінт: скрипт + ESLint блокують типові регреси (`navigate(\`/…`)`, `<Link to="/…">` у `src` поза allowlist).
- [x] Ручна перевірка замінена live Playwright denied-route pass: для ключових ролей заборонений URL нормалізується однаково, а high-risk workspace boundaries (`documents / contracts / invoices / cases` + `it_admin` deny на `patients / cases / reports / documents`) уже мають окремий browser proof.

## 5. Порядок і ризики

- **Порядок:** A → B → C → E (мінімум Vitest) → D → F.  
- **Ризик:** занадто широкі `prefix` патерни — ловити колізії в майбутніх шляхах; мінімізувати префікси або покривати тестами.  
- **Scope control:** дрібні обмеження всередині форми (які кнопки активні) можуть лишатися в сторінках; фокус плану — **вхід у воркспейс / маршрут**.

## 6. Зв’язані документи

- [04_rbac-e2e-test-plan_ua.md](04_rbac-e2e-test-plan_ua.md) — RBAC verification, піраміда тестів.
- [02_rbac-matrix_ua.md](../backlog/02_rbac-matrix_ua.md) — матриця ролей (джерело вимог).
- [current-state-gap-audit_ua.md](current-state-gap-audit_ua.md) — поточний зріз продукту.
