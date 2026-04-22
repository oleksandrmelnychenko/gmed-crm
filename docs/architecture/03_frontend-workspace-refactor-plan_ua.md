# Frontend Workspace Refactor Tracker (UA)

> Канонічний tracker для frontend-рефактора `app-shell -> record-workspace -> appointments split`.
>
> Файл відновлено `2026-04-21` після зникнення попереднього канонічного tracker-а з поточного worktree. Далі саме цей документ є source of truth для фаз, performance goals і tracking protocol.

## 1. Статус

- Поточний статус: `Done`
- Активна фаза: `none (P9 done)`
- Scope: staff frontend workspace
- Review context: `2026-04-21`

## 2. Ціль і межі

Ціль рефактора:

- винести глобальну authenticated-оболонку в окремий `app-shell` layer;
- зафіксувати нейтральний shared `record-workspace` layer;
- перестати тримати `appointments` як монолітний page-module;
- розвести feature responsibilities на `model / data / appearance / ui`;
- зменшити eager loading, зайві rerender-и і bundle pressure у staff workspace.

Поза scope цього tracker-а:

- backend API redesign;
- зміна product behavior у самих appointment workflows;
- глобальна міграція всіх сторінок frontend поза `patients / cases / appointments`.

## 3. Архітектурний контракт

### Target shape

```text
frontend/src/components/
  app-shell/
  record-workspace/

frontend/src/pages/
  appointments/
    index.ts
    compat/
      appointments.helpers.ts
      appointments.helpers.test.ts
    page.tsx
    model/
    data/
    appearance/
    ui/
```

### Layer law

| Layer | Відповідальність | Не повинен робити |
|------|------|------|
| `app-shell` | authenticated frame, nav, route-aware shell mounting, loading/access boundaries | знати feature-specific helpers напряму |
| `record-workspace` | shared header/nav/surface/sheet primitives і recipes | залежати від `patients` або `appointments` як design master |
| `model` | types, constants, selectors, mappers, query keys | імпортувати React, `data`, `appearance`, `ui` |
| `data` | fetchers, tab loaders, cache/dedupe, on-demand data orchestration | імпортувати UI |
| `appearance` | status/timeline/action/section bindings, feature-local visual vocabulary | тягнути API/data-fetch logic |
| `ui` | scheduler, workspace, sections, sheets, route composition | змішувати shared shell rules з data/model contract |

Dependency law:

- `model ->` imports nothing from React/UI layers.
- `data ->` may use `model`, never `ui`.
- `appearance ->` may use `model`, never `data`.
- `ui ->` may compose `model + data + appearance + shared shells`.

## 4. Фазовий tracker

| Phase | Status | Deliverable | Done when |
|------|------|------|------|
| `P0` | `Done` | Freeze vocabulary | зафіксовані `app-shell`, `record-workspace`, layer law, naming rules |
| `P1` | `Done` | `app-shell` extraction | global layout стає thin adapter, shell chrome живе в окремому layer |
| `P2` | `Done` | `record-workspace` extraction | shared workspace primitives/shells більше не сидять у feature pages |
| `P3` | `Done` | `appointments` split skeleton | route entry thin, feature code живе в `appointments/` |
| `P4` | `Done` | `model` layer extraction | types/selectors/mappers/query keys винесені й не тягнуть React |
| `P5` | `Deferred` | `data` layer split | route-level detail/tab/resource loading винесений у feature hooks; глибший SWR/cache-dedupe pass відкладено в наступний план |
| `P6` | `Done` | `appearance` layer split | status/timeline/sheet/section/action bindings живуть окремо від data/UI orchestration |
| `P7` | `Done` | `ui` layer split | scheduler, workspace, panels, sheets розбиті на feature-local UI modules |
| `P8` | `Done` | Performance hardening | hidden tabs не fetchаться upfront, heavy sheets lazy-load, rerender footprint локалізований |
| `P9` | `Done` | Final validation | lint/build green, targeted sanity checks green, residual tails documented |

## 5. Performance goals

Рефактор вважається успішним лише якщо після `P8-P9` зафіксовано:

- baseline з `frontend npm run build` знятий до активного split і порівняний після нього;
- `appointments` route chunk не гірший за baseline, бажано менший;
- hidden tabs не роблять code/data load до відкриття;
- heavy right sheets і editors відкриваються через lazy/on-demand path;
- відкриття/закриття sheet не ререндерить весь scheduler shell;
- mobile і desktop detail використовують один shared content tree;
- після close очищається ephemeral detail/sheet state;
- не додаються barrel exports для heavy feature areas.

## 6. Tracking protocol

Після кожної суттєвої зміни цей файл оновлюється обов'язково:

1. змінити статус рівно однієї активної фази;
2. додати короткий log row з датою, owner, touched paths і canonical outcome;
3. вписати verification, яким це підтверджено;
4. окремо зафіксувати blocker або deferred tail, якщо він лишився.

Допустимі статуси:

- `Planned`
- `In progress`
- `Blocked`
- `Done`
- `Deferred`

Правила ведення:

- одночасно лише одна фаза має бути `In progress`;
- `Done` без verification не ставиться;
- після старту `P3` новий великий код не додається в монолітний `appointments.tsx`, якщо його можна класти в target structure одразу;
- якщо concurrent work блокує фазу, статус змінюється на `Blocked` із короткою причиною, без переписування чужого коду.

## 7. Verification baseline

Мінімум для `Done` по великих фазах:

- `frontend npm run lint`
- `frontend npm run build`

Додатково для `appointments`-heavy фаз:

- targeted sanity check для scheduler/workspace;
- sanity check для linked sheets/editors;
- якщо змінюється detail composition: mobile + desktop detail smoke.

## 8. Change log

| Date | Phase | Note | Verification |
|------|------|------|------|
| `2026-04-21` | `Recovery` | Відновлено канонічний tracker на історичному шляху `docs/architecture/03_frontend-workspace-refactor-plan_ua.md`; README знову посилається на нього | doc presence + README link update |
| `2026-04-21` | `P0-P4` | Винесено `app-shell` з `layout.tsx`, розбито `ui-shell` у `record-workspace/*`, перенесено route entry у `pages/appointments/page.tsx`, додано `appointments/model/*` і переведено `appointments.helpers.ts` у compatibility adapter; поточний post-foundation baseline: `appointments-B4CokLKA.js 580.17 kB / 146.13 kB gzip` | `npm test -- src/components/app-shell/workspace-rail-resolver.test.tsx src/components/record-workspace/index.test.tsx`, `npm run lint`, `npm run build` |
| `2026-04-21` | `P4` | У `appointments/model/*` винесено основний domain type block, option/constants vocabulary і permission selectors; `page.tsx` тепер споживає model-layer замість локальних type/constant/policy declarations. Поточний baseline після цього кроку: `appointments-DQLeC6E2.js 580.41 kB / 146.11 kB gzip` | `npm run lint`, `npm run build` |
| `2026-04-21` | `P4` | Додано `appointments/model/labels.ts`, `appointments/model/query-builders.ts`, `appointments/model/schedule-warnings.ts`, `appointments/model/operational-scopes.ts` і `appointments/appearance/linked-document-badges.ts`; з `appointments/page.tsx` прибрано локальні label/query/document/schedule scope helper-и. Поточний baseline після цього кроку: `appointments-CYG_oyuk.js 580.43 kB / 146.24 kB gzip` | `npm run lint`, `npm run build` |
| `2026-04-21` | `P4` | Додано `appointments/model/recurrence.ts` і розширено `appointments/model/labels.ts` для recurrence/entity/workflow display helper-ів; з `appointments/page.tsx` прибрано локальні recurrence, patient/provider/staff display та task/billing/incoming-data label helper-и. Поточний baseline після цього кроку: `appointments-85bQPA3F.js 580.43 kB / 146.05 kB gzip` | `npm run lint`, `npm run build` |
| `2026-04-22` | `P4` | Додано `appointments/appearance/status-appearance.ts`, `appointments/appearance/timeline-appearance.ts` і `appointments/model/runtime-formatters.ts`; з `appointments/page.tsx` прибрано локальні status/timeline badge recipes та runtime date/time/money formatters. Поточний baseline після цього кроку: `appointments-DtOGfdrX.js 580.49 kB / 145.83 kB gzip` | `npm run lint`, `npm run build` |
| `2026-04-22` | `P4` | Додано `appointments/model/linked-preview.ts`, `appointments/model/workflow-helpers.ts` і `appointments/ui/shared/workspace-primitives.tsx`; з `appointments/page.tsx` прибрано локальні linked-preview/workflow helper-и та перший набір appointments-local UI primitives (`Editor/Preview sheet`, `Section intro`, `Field`, `EmptyState`, `KPI`, `Clinical toggle`). Поточний baseline після цього кроку: `appointments-Cb394VhR.js 580.49 kB / 145.94 kB gzip` | `npm run lint`, `npm run build` |
| `2026-04-22` | `P4/P7` | Додано `appointments/ui/shared/context-card.tsx` і перші section-level UI modules: `appointments/ui/sections/snapshot-section.tsx`, `attention-section.tsx`, `links-section.tsx`; відповідні локальні секції прибрано з `appointments/page.tsx`, який тепер споживає shared/section modules. Поточний baseline після цього кроку: `appointments-D4j8DZQ7.js 580.49 kB / 146.01 kB gzip` | `npm run lint`, `npm run build` |
| `2026-04-22` | `P4/P7` | Додано `appointments/ui/sections/timeline-section.tsx` і `overview-section.tsx`; з `appointments/page.tsx` прибрано локальні `timeline/overview` блоки, а `timeline` додатково отримав precomputed filter counts замість повторних `filter(...)` у render. Поточний baseline після цього кроку: `appointments-BAeMkRhL.js 580.61 kB / 145.91 kB gzip` | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Додано `appointments/ui/sheets/linked-provider-sheet.tsx` і `appointments/ui/sheets/linked-documents-sheet.tsx`; з `appointments/page.tsx` прибрано локальний provider preview flow, documents preview flow і мертвий `linkedDocumentSelectedIds` state для `DocumentsGrid` при `showSelection={false}`. Поточний baseline після цього кроку: `appointments-zGjItDeu.js 580.92 kB / 145.91 kB gzip` | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Додано `appointments/ui/sheets/linked-cases-sheet.tsx` і `appointments/ui/sheets/linked-records-sheet.tsx`; з `appointments/page.tsx` прибрано локальні `linked cases`/generic linked preview render-блоки, а preview state для `CaseWorkspaceModal` локалізовано всередину `linked-cases-sheet`. Поточний baseline після цього кроку: `appointments-DuOey-i1.js 581.24 kB / 145.85 kB gzip` | `npm run lint`, `npm run build` |
| `2026-04-22` | `P8` | Для `linked-provider`, `linked-cases`, `linked-documents`, `linked-records` увімкнено `React.lazy` + conditional mount + preload у `openLinkedPreview`; додано `AppointmentPreviewSheetLoadingState` як lightweight suspense fallback. Після цього `appointments` route chunk впав до `appointments-aSKfkEir.js 557.22 kB / 140.43 kB gzip`, а preview-flow винесені в окремі async chunks (`linked-provider-sheet`, `linked-cases-sheet`, `linked-documents-sheet`, `linked-records-sheet`). | `npm run lint`, `npm run build` |
| `2026-04-22` | `P8` | `MemoizedPatientDetailSheet` і `PatientAppointmentsPage` переведено на role/intent-gated lazy path: linked patient sheet preload-иться перед open, а patient appointments workspace тепер вантажиться через `Suspense` тільки для `user.role === "patient"`. Після цього з’явився окремий async chunk `patient-appointments-BDjaQimg.js 22.53 kB / 6.56 kB gzip`, а `appointments` route chunk знизився до `appointments-CkhpMfY6.js 536.42 kB / 135.38 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P4/P5/P8` | `CreateAppointmentSheet` винесено з моноліту в `appointments/ui/sheets/create-appointment-sheet.tsx` і переведено на `React.lazy` + preload перед open; супутню create-flow логіку для provider doctors і debounced conflict query винесено в `appointments/data/provider-doctors.ts` та `appointments/data/use-debounced-value.ts`, а shared conflict/warning panels у `appointments/ui/shared/schedule-panels.tsx`. Після цього з’явився окремий async chunk `create-appointment-sheet-6tcML8qQ.js 11.45 kB / 3.31 kB gzip`, `schedule-panels-Cyw4c0QG.js 10.70 kB / 3.97 kB gzip`, а `appointments` route chunk знизився до `appointments-BrzaIuLx.js 516.44 kB / 130.79 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Scheduler-side `search` і `queue` sheet-и винесено в `appointments/ui/sheets/search-sheet.tsx` і `queue-sheet.tsx` та переведено на `React.lazy` + preload перед open. Після цього з’явилися окремі async chunks `search-sheet-BfYz99J7.js 4.05 kB / 1.23 kB gzip` і `queue-sheet-DGOyck7q.js 3.83 kB / 1.26 kB gzip`, а `appointments` route chunk знизився до `appointments-zL0bldnm.js 503.88 kB / 128.11 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | `AppointmentReportSection` винесено з моноліту в `appointments/ui/sections/report-section.tsx` і переведено на hidden-tab `React.lazy` path для desktop і mobile detail. Після цього з’явився окремий async chunk `report-section-Bmb-orsw.js 9.26 kB / 3.34 kB gzip`, а `appointments` route chunk знизився до `appointments-BpU0_uT1.js 496.18 kB / 126.00 kB gzip`, тобто основний route chunk вперше пішов нижче `500 kB`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | `AppointmentIncomingDataSection` і `AppointmentFindingsSection` винесено з моноліту в спільний async module `appointments/ui/sections/clinical-follow-up-sections.tsx` і переведено на `React.lazy` path для desktop clinical tab та mobile detail. Після цього з’явився окремий async chunk `clinical-follow-up-sections-CFVcDeKl.js 27.39 kB / 6.83 kB gzip`, а `appointments` route chunk знизився до `appointments-BUcfvAa7.js 471.85 kB / 121.65 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | `AppointmentConciergeSection` винесено з моноліту в `appointments/ui/sections/concierge-section.tsx` і переведено на hidden-tab `React.lazy` path для services tab та mobile detail. Після цього з’явився окремий async chunk `concierge-section-D6rajZcd.js 12.23 kB / 3.01 kB gzip`, а `appointments` route chunk знизився до `appointments-CPkaYCSi.js 461.63 kB / 120.16 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | `AppointmentBillingHandoffSection` винесено з моноліту в `appointments/ui/sections/billing-handoff-section.tsx` і переведено на hidden-tab `React.lazy` path для services tab та mobile detail. Після цього з’явився окремий async chunk `billing-handoff-section-9R2GqjlQ.js 11.07 kB / 3.89 kB gzip`, а `appointments` route chunk знизився до `appointments-MZDsdQyW.js 452.18 kB / 118.50 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | `AppointmentExternalHandoffSection` винесено з моноліту в `appointments/ui/sections/external-handoff-section.tsx` і переведено на hidden-tab `React.lazy` path для workflow/co-ordination surface та mobile detail. Після цього з’явився окремий async chunk `external-handoff-section-hPscKUHt.js 11.74 kB / 3.61 kB gzip`, а `appointments` route chunk знизився до `appointments-Bd4Fw5C2.js 442.49 kB / 117.09 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | `AppointmentHandoffSection` винесено з моноліту в `appointments/ui/sections/handoff-section.tsx` і переведено на hidden-tab `React.lazy` path для workflow surface та mobile detail. Після цього з’явився окремий async chunk `handoff-section-o3Otg2Qv.js 4.03 kB / 1.69 kB gzip`, а `appointments` route chunk знизився до `appointments-Blq75asq.js 440.10 kB / 116.74 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | `AppointmentDoctorFollowUpSection` і `AppointmentPackageEndSection` винесено з моноліту в спільний async module `appointments/ui/sections/workflow-follow-up-sections.tsx` і переведено на hidden-tab `React.lazy` path для workflow surface та mobile detail. Після цього з’явився окремий async chunk `workflow-follow-up-sections-DNWN_HyS.js 12.90 kB / 3.03 kB gzip`, а `appointments` route chunk знизився до `appointments-Cib6E_WG.js 430.01 kB / 115.24 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | `AppointmentFollowUpVisitSection` винесено з моноліту в `appointments/ui/sections/follow-up-visit-section.tsx` і переведено на hidden-tab `React.lazy` path для workflow surface та mobile detail. Після цього з’явився окремий async chunk `follow-up-visit-section-Cu5hIo5l.js 9.86 kB / 3.10 kB gzip`, а `appointments` route chunk знизився до `appointments-GilvDBul.js 422.28 kB / 113.84 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Залишок workflow core (`WorkflowTab`, `completion/status/interpreter/checklist/reminders/tasks`) винесено з моноліту в спільний async module `appointments/ui/sections/workflow-surfaces.tsx`. Desktop workflow tab тепер іде через `React.lazy`, а mobile detail споживає ті самі lazy workflow surfaces замість локальних inline component block-ів. Після цього з’явився окремий async chunk `workflow-surfaces-RGAXiP76.js 32.24 kB / 8.42 kB gzip`, а `appointments` route chunk знизився до `appointments-DzSFufoP.js 380.72 kB / 104.67 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | `EditAppointmentSection` винесено з route-моноліту в `appointments/ui/sections/edit-appointment-section.tsx` і переведено на lazy path для desktop workflow logistics lane та mobile detail. Після цього з’явився окремий async chunk `edit-appointment-section-DoiVIOO_.js 9.22 kB / 3.02 kB gzip`, а `appointments` route chunk знизився до `appointments-DBolPglf.js 372.94 kB / 102.98 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Mobile detail body винесено з route-моноліту в async module `appointments/ui/sheets/mobile-detail-sheet-content.tsx`, а спільний notes surface стабілізовано через `appointments/ui/shared/text-panel.tsx`, щоб desktop/mobile більше не дублювали локальну `TextPanel` реалізацію. Після цього з’явився окремий async chunk `mobile-detail-sheet-content-DzHfyU5G.js 8.26 kB / 2.51 kB gzip`, а `appointments` route chunk знизився до `appointments-CDaFvTBS.js 342.76 kB / 97.78 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Notes surface винесено в shared section module `appointments/ui/sections/notes-section.tsx` і підключено як єдиний consumer для desktop notes tab та mobile detail stack; shared note cards живуть у `appointments/ui/shared/text-panel.tsx`, а mobile зберігає попередню поведінку через `hideWhenUnavailable`. Після цього з’явився окремий async chunk `notes-section-D9F1f-VZ.js 1.41 kB / 0.75 kB gzip`, а `appointments` route chunk знизився до `appointments-CAmv_1lj.js 342.62 kB / 97.75 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Desktop coordination tab orchestration винесено з route-моноліту в lazy module `appointments/ui/sections/coordination-section.tsx`; `page.tsx` більше не тримає inline handoff/follow-up/external-handoff desktop composition. Після цього з’явився окремий async chunk `coordination-section-DAJYh2HQ.js 2.30 kB / 0.88 kB gzip`, а `appointments` route chunk знизився до `appointments-9eAVBp9G.js 339.32 kB / 97.08 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Desktop clinical tab orchestration винесено з route-моноліту в lazy module `appointments/ui/sections/clinical-section.tsx`; із `page.tsx` прибрано inline clinical summary/counts/gating для intake/findings/report. Після цього з’явився окремий async chunk `clinical-section-BdsQQ9wh.js 3.66 kB / 1.68 kB gzip`, а `appointments` route chunk знизився до `appointments-CEnocy-G.js 335.45 kB / 96.00 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Desktop services tab orchestration винесено з route-моноліту в lazy module `appointments/ui/sections/services-section.tsx`; `page.tsx` більше не тримає inline concierge/billing desktop composition і service empty-state routing. Після цього з’явився окремий async chunk `services-section-DhAQjuVZ.js 1.65 kB / 0.83 kB gzip`, а `appointments` route chunk знизився до `appointments-swDgOnD7.js 334.42 kB / 95.73 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Увесь desktop detail workspace винесено з route-моноліту в lazy module `appointments/ui/workspace/desktop-detail-workspace-content.tsx`; `page.tsx` тепер лишається orchestration shell і монтує detail content через окремий `Suspense` boundary. Додатково hidden-tab lazy semantics збережено вже всередині нового workspace module, щоб `workflow/clinical/coordination/services/notes` не підвантажувались наперед при open detail. Після цього з’явився окремий async chunk `desktop-detail-workspace-content-CxhqQEit.js 10.36 kB / 3.30 kB gzip`, `workflow-surfaces` повернувся до `32.32 kB / 8.46 kB gzip`, а `appointments` route chunk знизився до `appointments-DjbgIRhz.js 329.33 kB / 94.63 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P8` | Для `openDetailSheet` додано `bundle-preload`: desktop заздалегідь тягне `desktop-detail-workspace-content`, а mobile одразу preload-ить `mobile-detail-sheet-content` ще до mount. Це не змінює структуру chunk-ів, але зменшує latency при відкритті detail view. Поточний baseline після цього кроку: `appointments-CMq0hCNW.js 329.35 kB / 94.64 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5/P8` | Detail loading розрізано на `core + permission-aware resource groups`: `appointments/model/detail-resource-needs.ts` тепер визначає потрібні resource groups по `detailTab` і ролі, а `appointments/data/detail-resource-groups.ts` забирає checklist/reminders/report/tasks/services/communications окремими fetchers. На desktop `overview/timeline/notes` більше не тягнуть розширені payload-и при першому open detail, а `coordination/clinical/workflow/services` добирають тільки потрібні групи; mobile detail лишається full-context surface. Поточний baseline після цього кроку: `appointments-Dfy4os7c.js 331.53 kB / 95.29 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P8` | Для detail-derived render work додано deferred gating: expensive reminders/tasks/services/communications derivations більше не рахуються на desktop `overview/timeline/notes`, а `buildAppointmentTimelineEvents(...)` викликається лише коли timeline реально видимий або відкритий mobile detail. Структура chunk-ів майже не змінилась, але `page.tsx` перестав робити зайві loops на cold open detail. Новий baseline: `appointments-C-OtNTN4.js 332.34 kB / 95.44 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5` | Appointment detail fetch/state orchestration винесено з `appointments/page.tsx` у `appointments/data/use-appointment-detail.ts`. Hook тепер інкапсулює core detail load, assignments, permission-aware resource-group loading, reset logic і `detailExtendedResourcesReady`, а route page споживає вже готовий data contract. Архітектурно це перший реальний feature-local data hook для appointments detail. Поточний baseline після цього кроку: `appointments-BcTX0fz6.js 333.17 kB / 95.65 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5` | Scheduler list + attention feed orchestration винесено з `appointments/page.tsx` у `appointments/data/use-appointments-scheduler-data.ts`. `page.tsx` тепер отримує `appointments`, `attentionItems`, `appointmentsLoading`, `appointmentsError` і `setAppointmentsError` із hook-а, а `appointmentsVersion` лишається тільки refresh trigger-ом на route рівні. Поточний baseline після цього кроку: `appointments-5V05W3Bd.js 333.51 kB / 95.74 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5` | Linked preview/provider/cases/documents loading винесено з route page у `appointments/data/use-appointment-linked-records.ts`, а linked patient detail/assignments/staff lookups у `appointments/data/use-appointment-linked-patient.ts`. `appointments/page.tsx` тепер тримає тільки open-state, explicit reset-path і mutation handler для patient assignment, без локального fetch/effect soup для right-sheet linked flows. Поточний baseline після цього кроку: `appointments-CJ8NyNiz.js 334.60 kB / 95.97 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5` | Appointments metadata (`patients/providers/interpreters/staff`) і dependent provider doctor options винесено з route page у `appointments/data/use-appointments-metadata.ts` та `use-provider-doctor-options.ts`. `appointments/page.tsx` тепер споживає lookup data через hooks і лишає в собі тільки orchestration reset для `providerId -> doctorId`. Поточний baseline після цього кроку: `appointments-Dtyk4XTj.js 334.87 kB / 96.07 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5` | Останні прямі route-level mutation виклики прибрано з `appointments/page.tsx`: `assign/status/schedule update` винесено в `appointments/data/appointment-mutations.ts`, а linked patient assignment selection/busy/error orchestration у `appointments/data/use-appointment-linked-patient-assignment.ts`. Після цього `page.tsx` більше не імпортує `apiFetch` напряму й працює як orchestration shell навіть для linked-patient action flow. Поточний baseline після цього кроку: `appointments-CH86l5Jg.js 335.73 kB / 96.26 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5/P7` | Route-level query sync і URL hydration винесено в `appointments/ui/hooks/use-appointment-route-sync.ts`: `syncQuery`, reset/filter handlers і `searchParams -> local state` orchestration більше не сидять inline в `appointments/page.tsx`. Додатково route hydration тепер одразу нормалізує `provider -> doctor` query state без окремого corrective effect. Поточний baseline після цього кроку: `appointments-D-FEY7_7.js 337.06 kB / 96.64 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5/P8` | Scheduler reschedule/status action orchestration винесено з route page у `appointments/data/use-appointment-scheduler-actions.ts`; `appointments/page.tsx` більше не тримає inline `handleInlineReschedule`/`performStatusChange` mutation block. У цьому ж проході прибрано серію route-level `set-state-in-effect` хвостів: quick-action menu reset тепер handler-driven, `followUpAssigneeId` і `operationalScope` нормалізуються як derived values, а `openLinkedPreview` dependency sync приведено до React Compiler-safe shape. Поточний baseline після цього кроку: `appointments-D-FEY7_7.js 337.06 kB / 96.64 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5/P7` | Scheduler controls (`dateClick`, `datesSet`, quick scopes, operational scope toggles, `create-from-date`, global `appointments:refresh-request` / `appointments:create-request`) винесено з route page у `appointments/ui/hooks/use-appointment-scheduler-controls.ts`. Після цього page більше не тримає inline calendar/filter control block і його розмір впав до ~`2757` рядків. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Calendar quick-action menu state, dismiss-effect, scope selector і `openCalendarQuickActionLayer(...)` винесено в `appointments/ui/hooks/use-appointment-calendar-quick-actions.ts`. `appointments/page.tsx` більше не тримає окремий quick-action menu state island і використовує shared dismiss callback для refresh/detail open flows. Поточний baseline після цього кроку: `appointments-DGRXGSAL.js 338.70 kB / 96.96 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5/P7` | Linked right-sheet state orchestration (`linked preview / patient / provider / cases / documents`) винесено з route page у `appointments/ui/hooks/use-appointment-linked-sheet-state.ts`. Додатково linked patient detail і assignment hooks тепер самі скидають локальний state по `open/id` сигналам, тому `appointments/page.tsx` більше не тримає manual reset-path для patient preview flow. `page.tsx` після цього кроку зменшився до ~`2738` рядків. Поточний baseline: `appointments-CFpNNOYZ.js 339.99 kB / 97.18 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5/P7` | Overlay visibility/preload orchestration для `filters/search/queue/create` винесено з route page у `appointments/ui/hooks/use-appointment-overlay-state.ts`. `appointments/page.tsx` більше не розкидає `setOpen/loadChunk` по toolbar і create sheet flows, а використовує feature-local open/change callbacks. Поточний baseline: `appointments-Dj4cBnA_.js 340.99 kB / 97.41 kB gzip`; route page після цього кроку має ~`2747` рядків. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5/P7` | Workspace session state (`appointmentsNotice`, version counters, `detailOpen/selectedId/detailVersion`, `followUpAssigneeId`) винесено з route page у `appointments/ui/hooks/use-appointment-workspace-session.ts`. `appointments/page.tsx` тепер споживає session hook як єдиний owner для notice/version/detail-session state, а локальні callbacks (`refreshAppointments`, `refreshDetail`, `handleEditSaved`, `handleFollowUpVisitCreated`) працюють поверх цього contract-а. Поточний baseline: `appointments-COzuPp2w.js 341.58 kB / 97.52 kB gzip`; route page після цього кроку має ~`2759` рядків. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P4/P7` | Calendar surface розкладено по правильних шарах: pure scheduler event mapping винесено з route page у `appointments/model/calendar-events.ts`, а DOM/overlay рендер у `appointments/ui/scheduler/appointment-calendar-event-card.tsx` та `appointment-calendar-quick-actions-menu.tsx`. `appointments/page.tsx` більше не тримає inline `toCalendarEvent`, `renderCalendarEventContent` і floating quick-actions menu block; після цього розмір route page впав до ~`2484` рядків. Поточний baseline: `appointments-B4vnp5x8.js 341.98 kB / 97.85 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7` | Mobile scheduler UX винесено з route page в `appointments/ui/scheduler/interpreter-mobile-agenda.tsx`. Разом із цим із `appointments/page.tsx` прибрано локальні `StatsCard`, `QuickScopeButton`, `MobileAgendaCard` і mobile agenda block; route page більше не тримає inline mobile scheduler cards/search/quick-scope surface. Поточний baseline: `appointments-DTrmsLeH.js 342.20 kB / 98.04 kB gzip`; route page після цього кроку має ~`2161` рядків. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7` | Desktop scheduler surface теж розкладено по feature-local modules: filters dialog винесено в `appointments/ui/scheduler/desktop-scheduler-filters-dialog.tsx`, а FullCalendar shell у `appointments/ui/scheduler/desktop-calendar-surface.tsx`. Після цього `appointments/page.tsx` більше не тримає inline filters dialog і FullCalendar/locales/plugins/calendar section block; route page впав до ~`2057` рядків. Поточний baseline: `appointments-B-FfUhjp.js 343.55 kB / 99.17 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5` | Appointment detail fetch/state orchestration винесено з `appointments/page.tsx` у `appointments/data/use-appointment-detail.ts`. Hook тепер інкапсулює core detail load, assignments, permission-aware resource-group loading, reset logic і `detailExtendedResourcesReady`, а route page споживає вже готовий data contract. Архітектурно це перший реальний feature-local data hook для appointments detail. Поточний baseline після цього кроку: `appointments-BcTX0fz6.js 333.17 kB / 95.65 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P5` | Scheduler list + attention feed orchestration винесено з `appointments/page.tsx` у `appointments/data/use-appointments-scheduler-data.ts`. `page.tsx` тепер отримує `appointments`, `attentionItems`, `appointmentsLoading`, `appointmentsError` і `setAppointmentsError` із hook-а, а `appointmentsVersion` лишається тільки refresh trigger-ом на route рівні. Поточний baseline після цього кроку: `appointments-5V05W3Bd.js 333.51 kB / 95.74 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7` | Shared scheduler chrome винесено з route page в `appointments/ui/scheduler/appointments-page-chrome.tsx`: header, create/refresh actions, KPI row і banner stack тепер однакові для desktop/mobile scheduler surfaces, а `DesktopSchedulerShell` лишився тільки контейнером для overlays/toolbar/calendar. Після цього `appointments/page.tsx` впав до ~`1992` рядків. Поточний baseline: `appointments-BFxKpnW7.js 344.60 kB / 99.49 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Root sheet wrappers для create/mobile detail винесено з route page в `appointments/ui/sheets/create-sheet-layer.tsx` і `mobile-detail-sheet.tsx`, а preload-функції переїхали поруч із lazy layers. `appointments/page.tsx` більше не тримає inline `Suspense + Sheet + fallback` boilerplate для create sheet і mobile detail shell; route page після цього кроку має ~`1938` рядків. Поточний baseline: `appointments-f4-6sXJA.js 344.95 kB / 99.62 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Linked right-sheet wrappers (`patient/provider/cases/documents/records`) і preload-ланцюжок винесено з route page в `appointments/ui/sheets/linked-sheet-layers.tsx`; для цього експортовано props-type contracts із відповідних sheet modules і `patients.tsx`. Після цього `appointments/page.tsx` більше не монтує inline lazy linked overlays і впав до ~`1798` рядків. Поточний baseline: `appointments-DrkSj69F.js 345.89 kB / 99.78 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P7/P8` | Увесь scheduler render-path винесено з route page в `appointments/ui/scheduler/appointments-scheduler-surface.tsx`: mobile agenda, desktop filters dialog, lazy `search/queue` sheet-и, toolbar і calendar surface тепер збираються в одному feature-local module, а preload `search/queue` переїхав поруч із ним. `appointments/page.tsx` після цього кроку має ~`1737` рядків і лишається orchestration shell для data/state/session layer. Поточний baseline: `appointments-DvjeYPv7.js 346.39 kB / 99.87 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P6` | Запущено `appearance` layer extraction: додано `appointments/appearance/surface-appearance.ts` і `scheduler-appearance.ts`, а `page.tsx`, `desktop-detail-workspace-content.tsx`, `desktop-scheduler-toolbar.tsx`, `interpreter-mobile-agenda.tsx`, `workflow-surfaces.tsx`, `workflow-follow-up-sections.tsx` переведені на спільні surface/control/scheduler recipes замість локальних `sectionCardClass` і ad-hoc class bindings. `appointments/page.tsx` після цього кроку має ~`1730` рядків. Поточний baseline: `appointments-RlCbDWUE.js 346.48 kB / 99.93 kB gzip`. | `npm run lint`, `npm run build` |
| `2026-04-22` | `P6` | Друга хвиля `appearance` extraction добила shared surface/control recipes у workflow/services/report/notes shells: на `surface-appearance.ts` переведено `notes-section`, `coordination-section`, `services-section`, `handoff-section`, `billing-handoff-section`, `concierge-section`, `edit-appointment-section`, `external-handoff-section`, `follow-up-visit-section`, `workflow-follow-up-sections`, `workflow-surfaces`, `report-section`. Окремо прибрано залишки raw `rounded-2xl bg-slate-50/80` / `h-10 rounded-xl bg-slate-50` / white pill-row recipes з основних appointment sections; grep по цих canonical дублях у `frontend/src/pages/appointments/**/*.tsx` більше не знаходить збігів. `appointments/page.tsx` лишається ~`1730` рядків. Поточний baseline після цього проходу: `appointments-BTAGIZrf.js 346.48 kB / 99.93 kB gzip`. | `npm run lint`, `npm run build`, targeted `rg` по raw duplicated surface/control recipes |
| `2026-04-22` | `P6` | Preview-sheet surfaces теж підтягнуто під `appearance`: додано `appointmentPreviewInfoCardClassName` у `surface-appearance.ts` і переведено `linked-provider-sheet.tsx` та `linked-records-sheet.tsx` на shared preview info-card recipe замість локального `cn(..., tokens.surface.card)`. Після цього в linked preview flow не лишилось route-local/preview-local дублювання card surface, окрім свідомих shared primitive випадків у `workspace-primitives.tsx` і `tokens.surface.mutedCard` для muted note blocks. Поточний baseline: `appointments-qswi-GR6.js 346.49 kB / 99.93 kB gzip`. | `npm run lint`, `npm run build`, targeted `rg` по preview card recipes |
| `2026-04-22` | `P6/P9` | Останній appearance tail у `clinical-follow-up-sections.tsx`, `report-section.tsx` і `workspace-primitives.tsx` переведено на shared `surface-appearance` recipes; `appointments-overview.spec.ts` оновлено під поточний intended linked-records UX без старого redirect/schnellvorschau copy. Фінальний baseline цього плану: `appointments-BBgDNQmh.js 346.39 kB / 99.91 kB gzip`, route page лишається ~`1730` рядків. Residual tails свідомо залишені для наступного плану: глобальний `index` chunk warning і deeper SWR/cache-dedupe pass для `appointments/data`. | `npm run lint`, `npm run build`, `npm run test -- src/pages/appointments.helpers.test.ts src/components/app-shell/workspace-rail-resolver.test.tsx src/components/record-workspace/index.test.tsx`, `npm run test:e2e -- tests/e2e/appointments-overview.spec.ts tests/e2e/appointments-workflow.spec.ts tests/e2e/appointments-recurring.spec.ts`, targeted `rg` по raw duplicated surface/control recipes |
| `2026-04-22` | `P3/P7/P9` | Root `src/pages` і `src/components` cleanup доведено до симетричного feature-local setup: `appointments.tsx` замінено на `frontend/src/pages/appointments/index.ts`, `appointments.helpers.ts` і test перенесено в `frontend/src/pages/appointments/compat/*`, а `AppointmentWorkspaceNav` перенесено в `frontend/src/pages/appointments/ui/appointment-workspace-nav.tsx` з thin compatibility wrapper у `frontend/src/components/appointments/compat/workspace-nav.tsx`. Після цього в коренях `pages/` і `components/` більше немає змішаного `appointments*` clutter. | `frontend npm run lint`; `frontend npm run build`; root inventory via `Get-ChildItem frontend/src/pages -File` і `Get-ChildItem frontend/src/components -File` |
