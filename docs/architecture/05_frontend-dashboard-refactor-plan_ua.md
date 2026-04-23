# Frontend Dashboard Refactor Tracker (UA)

> Канонічний tracker для рефактора `dashboard` route, staff dashboard workspace і route-level code splitting.

## 1. Статус

- Поточний статус: `In progress`
- Активна фаза: `P6`
- Scope: `frontend/src/pages/dashboard.tsx`, `frontend/src/pages/dashboard/*`, `frontend/src/pages/staff-dashboard-new.tsx`, `frontend/src/pages/patient-dashboard.tsx`
- Review context: `2026-04-23`

## 2. Ціль

- прибрати legacy dashboard rollback-моноліт із root route file;
- звести dashboard до такого самого `model / data / ui` сетапу, як `appointments` і `patients`;
- відокремити staff dashboard від patient portal dashboard через feature-local route composition;
- зменшити тиск на `index` chunk через route-level lazy loading і section-level code splitting;
- зафіксувати для dashboard окремий tracker, щоб далі не змішувати цей цикл із попередніми frontend refactor tracks.

## 3. Target Shape

```text
frontend/src/pages/
  dashboard.tsx
  staff-dashboard-new.tsx
  patient-dashboard.tsx
  dashboard/
    page.tsx
    staff-page.tsx
    data/
    model/
    ui/
      sections/
      shared/
```

Правило:

- root `pages/*.tsx` для dashboard повинні бути тільки route/compat adapters;
- реальна dashboard implementation живе лише в `pages/dashboard/*`;
- staff-specific chart/section logic не повертається назад у root page files.

## 4. Фази

| Phase | Status | Deliverable | Done when |
|------|------|------|------|
| `P0` | `Done` | Freeze dashboard scope | визначені canonical files, target shape і boundary rules |
| `P1` | `Done` | Dashboard feature-folder skeleton | `dashboard/page.tsx` і `dashboard/staff-page.tsx` існують, root route files стають adapters |
| `P2` | `Done` | Staff dashboard `model/data` extraction | fetch logic, payload types і formatters винесені з route-level component |
| `P3` | `Done` | Staff dashboard section split | overview/demographics/clinical/operations/activity винесені в `ui/sections/*` |
| `P4` | `Done` | Root legacy dashboard cleanup | `frontend/src/pages/dashboard.tsx` більше не тримає dead rollback blob |
| `P5` | `Done` | Route-level lazy split | `DashboardPage` lazy-load-ить staff/patient dashboard surfaces |
| `P6` | `In progress` | Section-level perf hardening | async sections, lighter surface primitives, reduced cold route pressure |
| `P7` | `Planned` | Final validation and tails | residual chunk tails documented, targeted smoke/lint/build green |

## 5. Поточний зріз

Після поточного проходу:

- [dashboard.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/dashboard.tsx) = thin route entry
- [page.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/dashboard/page.tsx) = route orchestration з `React.lazy`
- [staff-page.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/dashboard/staff-page.tsx) = staff dashboard orchestration shell
- `model`: `staff-dashboard-types.ts`, `staff-dashboard-formatters.ts`
- `data`: `use-staff-dashboard-data.ts`
- `ui/sections`: `overview`, `demographics`, `clinical`, `operations`, `activity`
- `ui/shared`: `dashboard-route-loading`, `staff-dashboard-surface-primitives`, `staff-dashboard-chart-primitives`

## 6. Поточні performance notes

Останній build baseline:

- `index`: `243.37 kB / 75.63 kB gzip`
- `staff-page`: `31.12 kB / 9.26 kB gzip`
- `staff-dashboard-surface-primitives`: `5.64 kB / 1.84 kB gzip`
- `staff-dashboard-chart-primitives`: `51.60 kB / 14.40 kB gzip`
- `CartesianChart`: `309.63 kB / 92.66 kB gzip`
- `patient-dashboard`: `20.27 kB / 5.44 kB gzip`

Residual tail:

- `index` warning більше не про dashboard, а загальний app-shell/input graph;
- найбільший dashboard-specific tail зараз це великий `CartesianChart` chunk з Recharts graph.

## 7. Done Criteria

Dashboard refactor вважається завершеним, коли:

- root `dashboard.tsx` лишається thin adapter;
- staff dashboard не містить inline section моноліту;
- staff/patient dashboard surfaces lazy-load-яться окремо;
- `lint` і `build` зелені;
- residual dashboard bundle tails зафіксовані в цьому tracker-і.
