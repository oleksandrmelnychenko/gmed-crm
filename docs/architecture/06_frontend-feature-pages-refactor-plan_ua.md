# Frontend Feature Pages Refactor Tracker (UA)

> Канонічний tracker для наступної хвилі frontend-рефактора після `appointments`, `patients` і `dashboard`.
>
> Ціль: довести решту staff pages до того самого feature-local setup, щоб root `frontend/src/pages` перестав бути набором великих route-монолітів.

## 1. Статус

- Поточний статус: `In progress`
- Активна фаза: `core staff pages + chat/sops/admin/portal/topbar P3 done; route-level lazy + API GET dedupe/cache verified; deeper P5 UI splits remain for largest pages`
- Scope: root staff pages, які ще не мають власного feature folder
- Review context: `2026-04-25`

## 2. Еталонний патерн

Еталон уже є у двох місцях:

- `frontend/src/pages/appointments/*`
- `frontend/src/pages/patients/*`

Обов'язкова форма для кожної великої сторінки:

```text
frontend/src/pages/
  <feature>/
    index.ts
    page.tsx
    compat/
    model/
    data/
    appearance/
    ui/
      hooks/
      sections/
      shared/
      sheets/
```

Для detail route або окремого workspace дозволені додаткові thin entries:

```text
<feature>/
  detail-entry.ts
  detail-page.tsx
```

Root `frontend/src/pages/<feature>.tsx` після міграції має зникати або бути тимчасовим thin compatibility adapter. Реальна implementation не повертається в root file.

## 3. Layer Law

Ті самі правила, що у `appointments` / `patients`:

| Layer | Відповідальність | Заборонено |
|------|------|------|
| `model` | types, constants, selectors, mappers, query builders, pure formatters | React, `apiFetch`, UI imports |
| `data` | fetch hooks, mutations, resource loading, cache/session triggers | UI components |
| `appearance` | feature-local status tones, class recipes, visual vocabulary | API/data loading |
| `ui` | sections, sheets, tables, workspace composition, route-local hooks | business rules, raw transport |
| `page.tsx` | route orchestration only | inline tables/sheets/large sections/direct API soup |
| `index.ts` | public route export + compatibility exports | implementation logic |

Shared layers:

- `components/app-shell` owns authenticated shell and route chrome.
- `components/record-workspace` owns reusable workspace primitives.
- `components/data-table` owns generic table/split-view behavior.
- Feature-local UI must not be promoted into global `components/*` unless it is truly shared by at least two independent features.

## 4. Поточний Inventory

Root pages that still need the pattern, ordered by current size and risk:

| Route file | Size | Target feature | Notes |
|------|------:|------|------|
| `orders.tsx` | ~280 KB | `pages/orders/*` | P1 skeleton done; biggest monolith; split list/detail, process gates, financial gates, external invoices, sheets |
| `cases.tsx` | ~186 KB | `pages/cases/*` | P1 skeleton done; has `case-workspace` feature already; list/workspace boundary should be normalized |
| `documents.tsx` | ~182 KB | `pages/documents/*` | P1 skeleton done; high RBAC/share/translation surface; needs data/model split before UI split |
| `reports.tsx` | ~115 KB | `pages/reports/*` | P1 skeleton done; KPI/reporting-heavy; likely chart/data split first |
| `contracts.tsx` | ~115 KB | `pages/contracts/*` | P1 skeleton done; commercial workspace; pair with invoices/orders contracts surfaces carefully |
| `providers.tsx` | ~100 KB | `pages/providers/*` | P1 skeleton done; provider detail type is imported by appointments, so public exports must stay stable |
| `invoices.tsx` | ~79 KB | `pages/invoices/*` | P1 skeleton done; billing detail/actions; coordinate with contracts/orders |
| `leads.tsx` | ~78 KB | `pages/leads/*` | P1 skeleton done; already has helpers/tests; migrate helpers into `compat`/`model` |
| `feedback.tsx` | ~70 KB | `pages/feedback/*` | P1 skeleton done; role-scoped queue/review surfaces; good candidate after commercial stack |
| `admin-compliance.tsx` | ~56 KB | `pages/admin/compliance/*` or `pages/admin-compliance/*` | admin pages should get a separate admin convention |
| `provider-detail.tsx` | ~46 KB | `pages/providers/detail-*` | should move with providers, not stay as root peer |
| `chat.tsx` | ~39 KB | `pages/chat/*` | P1/P2/P3 done; secure message state remains route-local until a later UI split |
| `sops.tsx` | ~30 KB | `pages/sops/*` | P1/P2/P3 done; low-risk UI section split can be deferred |
| admin root pages | 11-32 KB | `pages/admin/*` | shared `pages/admin/data/admin-api.ts` done; full admin UI/model convention remains a later slice |

Already aligned or in progress:

- `appointments`: feature folder complete; residual tail is deeper data cache/dedupe, not page shape.
- `patients`: feature folder complete; final validation phase is active.
- `dashboard`: feature folder exists; final perf/validation tail remains.
- `case-workspace`: already a feature folder, but `cases.tsx` still needs list-side normalization.

## 5. Recommended Migration Order

1. `providers`
   - Medium size, clear public type export dependency from appointments.
   - Good first pass to prove feature-folder migration without touching the largest business flow.

2. `orders`
   - Largest root monolith and central operational/billing surface.
   - Needs staged split: `model/types`, `model/labels`, `data/use-orders-*`, `ui/sections`, `ui/sheets`.

3. `documents`
   - High-risk RBAC and sharing/translation flows.
   - Split transport and permissions before moving visual sections.

4. `contracts` + `invoices`
   - Commercial stack should be aligned together because orders/patients link into both.

5. `cases`
   - Normalize list page and integrate cleanly with existing `case-workspace/*`.

6. `leads` + `feedback`
   - Smaller but user-facing; preserve existing helper tests as compatibility proof.

7. `reports`
   - Split report model/data/chart sections and lazy-load expensive charts.

8. `admin/*`, `chat`, `sops`
   - Finish with lower-risk or convention-specific pages.

## 6. Phase Template Per Feature

Each feature migration should use this small repeatable loop:

| Phase | Deliverable |
|------|------|
| `P0` | freeze current imports, public exports, tests and route behavior |
| `P1` | create feature folder and move route entry to `index.ts` / `page.tsx` |
| `P2` | extract `model` types/helpers/selectors/query builders |
| `P3` | extract `data` hooks and mutations; route page stops importing `apiFetch` directly |
| `P4` | extract `appearance` recipes if the feature has repeated class/status mappings |
| `P5` | split `ui` sections/sheets/tables into feature-local modules |
| `P6` | add lazy/on-demand loading for hidden tabs, heavy sheets and chart/report areas |
| `P7` | verification: lint, build, focused unit/e2e where coverage exists |

## 7. Hard Rules

- Do not add new large code to root `frontend/src/pages/*.tsx`.
- Do not create global `components/<feature>-*` for feature-only UI.
- Keep compatibility exports for routes/types used by other features.
- Move tests with helpers when helpers move; keep root adapters only while imports are being normalized.
- Lazy-load hidden tabs, sheets, editors, preview panels and heavy chart surfaces.
- If a page is role-sensitive, split permissions/selectors into `model` before UI work.
- If a page touches money, contracts or patient data, run targeted e2e or existing regression specs after structural moves.

## 8. Verification Baseline

Minimum after each feature pass:

- `cd frontend; npm run lint`
- `cd frontend; npm run build`

Targeted verification by slice:

- `providers`: provider live/e2e smoke and appointments linked-provider smoke if touched.
- `orders`: `orders` backend/frontend regression, plus billing gate smoke.
- `documents`: documents/share/translation e2e or live smoke.
- `contracts` / `invoices`: commercial and billing e2e smoke.
- `cases`: case workspace/list e2e smoke.
- `leads`: helper unit tests + leads e2e smoke.
- `feedback`: feedback e2e/live scoped-role smoke.

## 9. Current Worktree Note

At the time this tracker was created, the worktree already had unrelated local modifications in:

- `frontend/src/lib/api.ts`
- `frontend/src/pages/patients/list-page.tsx`
- `frontend/src/pages/patients/ui/hooks/use-patients-list-view-state.ts`
- `frontend/tests/e2e/patients-datatable.spec.ts`

Future migration commits should avoid touching or reverting those changes unless they become part of the same explicit task.

## 10. Change Log

| Date | Feature | Phase | Note | Verification |
|------|------|------|------|------|
| `2026-04-25` | `all` | `P0` | Created global tracker for migrating remaining root feature pages to the `appointments` / `patients` architecture. Inventory and migration order are based on current root page sizes and import dependencies. | local code inspection |
| `2026-04-25` | `providers` | `P1` | Created `frontend/src/pages/providers/` skeleton: moved root `providers.tsx` to `providers/page.tsx`, moved `provider-detail.tsx` to `providers/detail-page.tsx`, added `index.ts` and `detail-entry.ts`, and updated the provider detail route import in `App.tsx`. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `main feature pages` | `P1` | Created thin feature-folder route entries for `orders`, `cases`, `documents`, `contracts`, `invoices`, `leads`, `feedback`, `reports`, `sops` and `chat`. Root implementations moved to `<feature>/page.tsx`, with `index.ts` re-exporting the route component. Relative imports for `cases.snippets` and `leads.helpers` were adjusted after the move. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `providers` | `P2` | Moved provider list/detail/form/template payload types and pure list/detail helpers into `providers/model/*`. `providers/index.ts` now exports the public `ProviderDetail` type from the model layer instead of the route component. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `providers` | `P3` | Added `providers/data/provider-api.ts` and routed provider list/detail/template mutations through feature-local data functions. `providers/page.tsx` and `providers/detail-page.tsx` no longer import `apiFetch` directly. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `orders` | `P2` | Started the orders model split by moving API/business/form types to `orders/model/types.ts`, pure constants/form helpers/formatters to `orders/model/order-model.ts`, and status/class recipes to `orders/appearance/status-appearance.ts`. The route page still owns UI composition and transport while the next P3/P5 slices are staged. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `orders` | `P3` | Added `orders/data/order-api.ts` and routed order directory loading, list/detail workspace loading, debt queue, phase changes, gate updates, Leistungen, external invoices and workflow checklist mutations through feature-local data functions. `orders/page.tsx` no longer imports `apiFetch` directly. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `documents` | `P2` | Moved document API/form/template/share/translation types to `documents/model/types.ts`, document permissions/query/form/template helpers to `documents/model/document-model.ts`, and repeated badge recipes to `documents/appearance/status-appearance.ts`. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `documents` | `P3` | Added `documents/data/document-api.ts` and routed lookup loading, list/detail/intake loading, patient context loading, upload/generate, preview/download, translation, share, portal release and stored-file delete operations through feature-local data functions. `documents/page.tsx` no longer imports `apiFetch`, `buildApiUrl` or `getAccessToken` directly. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `contracts` | `P2` | Moved contract/quote/catalog types to `contracts/model/types.ts`, pure form/query/formatter/permission helpers to `contracts/model/contracts-model.ts`, and status badge recipes to `contracts/appearance/status-appearance.ts`. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `contracts` | `P3` | Added `contracts/data/contracts-api.ts` and routed lookup/list/detail, quote workspace, contract/quote creation, catalog save and status mutations through feature-local data functions. `contracts/page.tsx` no longer imports `apiFetch` directly. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `invoices` | `P2` | Moved invoice/accounting/dunning types to `invoices/model/types.ts`, pure permissions/query/form/formatter helpers to `invoices/model/invoice-model.ts`, and invoice/dunning tone recipes to `invoices/appearance/status-appearance.ts`. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `invoices` | `P3` | Added `invoices/data/invoice-api.ts` and routed lookup/list/detail/accounting, invoice creation, status changes, dunning creation and protected PDF/CSV blob loading through feature-local data functions. `invoices/page.tsx` no longer imports `apiFetch`, `buildApiUrl` or `getAccessToken` directly. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `cases` | `P2` | Staged the cases domain model split with `cases/model/types.ts`, `cases/model/case-model.ts`, and wired status badge appearance through `cases/appearance/status-appearance.ts`. Full helper import cleanup remains a separate low-risk follow-up because the clinical form is still a large route-level UI surface. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `cases` | `P3` | Added `cases/data/case-api.ts` and routed lookup loading, snippets, case list/detail loading, case creation, snippet save and all clinical section mutations through feature-local data functions. `cases/page.tsx` no longer imports `apiFetch` directly. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `leads` | `P2` | Moved lead route types/constants/form helpers and the existing tested conversion/contact helpers into `leads/model/*`; kept `leads.helpers.ts` as a compatibility re-export for the existing unit test. Status, compliance and row accent recipes moved to `leads/appearance/status-appearance.ts`. | `cd frontend; npm run lint`; `cd frontend; npm test -- leads.helpers.test.ts`; `cd frontend; npm run build` |
| `2026-04-25` | `leads` | `P3` | Added `leads/data/leads-api.ts` and routed list/detail/stats loading, lead creation, status updates, gate updates, failed-lead resolution, conversion and attachment download through feature-local data functions. `leads/page.tsx` no longer imports `apiFetch` or lead API helpers directly. | `cd frontend; npm run lint`; `cd frontend; npm test -- leads.helpers.test.ts`; `cd frontend; npm run build` |
| `2026-04-25` | `feedback` | `P2` | Moved feedback form, patient option types and role/query/form helpers into `feedback/model/*`. Existing portal-shared feedback formatting remains shared from the patient portal model. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `feedback` | `P3` | Added `feedback/data/feedback-api.ts` and routed patient portal feedback loading/submission plus staff feedback loading, patient/appointment lookups, capture and review mutations through feature-local data functions. `feedback/page.tsx` no longer imports `apiFetch` directly. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `data-table` | `verification fix` | Removed a stale unused `ScrollMetrics` type from the already-modified shared data table so global lint/build could pass without reverting the existing local data-table changes. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `reports` | `P2` | Moved report formatting and report-access role helpers into `reports/model/report-model.ts`. The large report payload schema remains route-local for now while chart/table UI is still unsplit. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `reports` | `P3` | Added `reports/data/reports-api.ts` and routed workspace/forecast loading plus protected CSV export through feature-local data functions. `reports/page.tsx` no longer imports `apiFetch`, `buildApiUrl` or `getAccessToken` directly. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `sops` | `P2/P3` | Added SOP model/types, status appearance recipes and `sops/data/sops-api.ts`. SOP workspace, save/review/acknowledgement operations now go through the feature data layer and `sops/page.tsx` no longer imports `apiFetch` directly. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `chat` | `P2/P3` | Added chat model/types and `chat/data/chat-api.ts`. Conversation/message loading, read markers, WebSocket creation, secure attachment bytes, upload and send mutations now sit behind the feature data layer. `chat/page.tsx` no longer imports raw API/url/token helpers. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `admin` | `P3` | Added shared `pages/admin/data/admin-api.ts` and routed users, access, settings, activity, security, health, compliance, notifications, custom fields and announcements through semantic admin data functions. Admin route pages no longer import `@/lib/api` directly. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `patient portal` | `P3` | Added `patients/data/portal-api.ts` and routed portal dashboard, appointments, documents, services, invoices and privacy pages through patient-portal data functions. Portal route pages no longer import `apiFetch` or `downloadApiFile` directly. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `topbar` | `P3` | Added `components/topbar-data.ts` and moved notification, announcement, presence and quick-chat API calls out of the shared `Topbar` UI component. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `routing/dashboard` | `P6` | Converted the dashboard route import in `App.tsx` to `React.lazy` and replaced the stale root `staff-dashboard-new.tsx` implementation with a compatibility re-export to the feature-folder dashboard module. Production build now emits dashboard/admin/portal/chat/sops as separate chunks. | `cd frontend; npm run lint`; `cd frontend; npm run build` |
| `2026-04-25` | `api-client/data APIs` | `P6/P7` | Added shared in-flight GET dedupe, opt-in short TTL JSON cache and mutation invalidation in `lib/api.ts`. Applied conservative TTLs to read-heavy dashboard, admin, topbar, reports/leads stats, appointment/patient/provider lookups, cases/orders/documents/contracts/invoices/feedback/sops metadata and patient portal reads. Abortable requests, message streams, file downloads/uploads, WebSockets and mutations stay uncached; direct upload helpers and auth token changes clear the shared cache. | `cd frontend; npm test -- api.test.ts`; `cd frontend; npm run lint`; `cd frontend; npm run build` |
