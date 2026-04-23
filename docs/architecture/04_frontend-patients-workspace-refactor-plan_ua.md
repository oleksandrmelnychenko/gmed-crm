# Frontend Patients Workspace Refactor Tracker (UA)

> Канонічний tracker для наступного frontend-рефактора: `record-workspace -> patients split`.
>
> Цей документ продовжує підхід із `03_frontend-workspace-refactor-plan_ua.md`, але вже для `patients` list/detail stack. Він є source of truth для фаз, scope, performance goals і tracking protocol цього циклу.

## 1. Статус

- Поточний статус: `In progress`
- Активна фаза: `P8`
- Scope: staff frontend patients workspace
- Review context: `2026-04-23`

## 2. Поточний зріз

Поточний `patients` slice уже частково сидить на новому shared vocabulary, але архітектурно ще не доведений до того самого рівня, що `appointments`.

Актуальні больові точки:

- [index.ts](/c:/Users/123/Downloads/dev/frontend/src/pages/patients/index.ts) уже thin route adapter; головний list monolith перенесений у [list-page.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/patients/list-page.tsx), зараз близько `365` рядків після винесення list sheets, toolbar, table surface, view-state hooks і derived table model.
- [detail-entry.ts](/c:/Users/123/Downloads/dev/frontend/src/pages/patients/detail-entry.ts) уже thin route adapter; головний detail monolith перенесений у [detail-page.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/patients/detail-page.tsx), зараз близько `2028` рядків після винесення workspace composition.
- [form-primitives.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/patients/compat/form-primitives.tsx) уже зведений до compatibility adapter, а канонічний модуль живе в [patient-form-primitives.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/patients/ui/shared/patient-form-primitives.tsx).
- [workspace-nav.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/patients/compat/workspace-nav.tsx) уже є thin re-export wrapper; канонічний rail живе в [patient-workspace-nav.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/patients/ui/patient-workspace-nav.tsx).
- root `patient-*` clutter у [frontend/src/pages](/c:/Users/123/Downloads/dev/frontend/src/pages) уже прибраний: route entries сидять у `frontend/src/pages/patients/index.ts` і `frontend/src/pages/patients/detail-entry.ts`, а legacy adapters/tests зібрані в `frontend/src/pages/patients/compat/*`.
- root `patient-*` clutter у [frontend/src/components](/c:/Users/123/Downloads/dev/frontend/src/components) теж уже прибраний: compatibility wrappers зібрані в `frontend/src/components/patients/compat/*`, а feature-local implementations живуть у `frontend/src/pages/patients/*`.
- detail page тримає великий state/data/mutation surface прямо в route-level module.
- `patients` ще не має такого ж чіткого `model / data / appearance / ui` split, як уже зроблено для `appointments`.

## 3. Ціль і межі

Ціль рефактора:

- привести `patients` до того самого setup, що вже зафіксований для `appointments`;
- зробити `patients.tsx` і `patient-detail.tsx` thin route entries;
- розвести patient feature на `model / data / appearance / ui`;
- забрати patient-local pseudo-shared primitives з глобальних `components/*`, якщо вони не є справжнім shared layer;
- зменшити route-level state soup, eager work і bundle pressure в list/detail flow;
- уніфікувати list/detail/sheets на `record-workspace` contract.

Поза scope:

- backend redesign для patient API;
- зміна product behavior самих patient workflows;
- повна міграція всіх legal/financial/document features за межами patient workspace, якщо вони вже мають власні стабільні surface modules.

## 4. Архітектурний контракт

### Target shape

```text
frontend/src/pages/
  patients/
    index.ts
    detail-entry.ts
    compat/
    list-page.tsx
    detail-page.tsx
    model/
    data/
    appearance/
    ui/
```

### Layer law

`patients` має сісти на ті самі shared layers:

- `app-shell`
- `record-workspace`

І на ті самі feature-local layers:

- `model`
- `data`
- `appearance`
- `ui`

Dependency law:

- `model ->` no React, no `data`, no `ui`
- `data ->` may use `model`, never `ui`
- `appearance ->` may use `model`, never `data`
- `ui ->` composes `model + data + appearance + record-workspace`

Додаткове правило для цього циклу:

- після старту `P1` новий patient UI не додається назад у великі route files, якщо його можна класти одразу в `frontend/src/pages/patients/*`

## 5. Фазовий tracker

| Phase | Status | Deliverable | Done when |
|------|------|------|------|
| `P0` | `Done` | Freeze vocabulary and scope | зафіксовано target shape, layer law, naming rules і current-state inventory |
| `P1` | `Done` | `patients` feature skeleton | `patients.tsx` і `patient-detail.tsx` стають thin entries, target folders створені |
| `P2` | `Done` | `model` extraction | patient types/selectors/mappers/helpers винесені й не тягнуть React |
| `P3` | `Done` | `data` extraction | list/detail fetch flows, assignments, preview resources і mutations винесені з route modules |
| `P4` | `Planned` | `appearance` extraction | patient-local visual bindings і control/surface recipes сидять у `patients/appearance/*` |
| `P5` | `Done` | list UI split | table/list/create/detail-sheet surfaces розбиті на feature-local UI modules |
| `P6` | `Done` | detail UI split | patient detail workspace, tabs, sheets, dialogs і section blocks винесені з `patient-detail.tsx` |
| `P7` | `Done` | Performance hardening | hidden tabs і heavy preview/dialog flows lazy-load, detail state локалізований |
| `P8` | `In progress` | Final validation | lint/build/test green, targeted e2e sanity green, residual tails documented |

## 6. Performance goals

Рефактор вважається успішним, якщо:

- `patients.tsx` і `patient-detail.tsx` більше не є головними монолітами feature-а;
- list route не тягне detail-only UI наперед;
- detail route не тягне hidden tab flows до відкриття;
- modal/sheet/dialog flows відкриваються через lazy/on-demand path там, де це виправдано;
- route-level state ownership помітно зменшений;
- patient-local pseudo-shared style layer або зникає, або стає true feature-local adapter;
- verification green не тільки по `lint/build`, а й по patient unit/e2e sanity.

## 7. Verification contract

Мінімум для великих фаз:

- `frontend npm run lint`
- `frontend npm run build`

Для фінальної фази:

- patient unit tests
- targeted patient e2e smoke
- якщо змінюється detail workspace: list route + detail route smoke

## 8. Tracking protocol

Після кожного суттєвого кроку:

1. змінюється активна фаза;
2. додається log row з touched paths і canonical outcome;
3. фіксується verification;
4. якщо лишився хвіст, він записується як `Deferred` або в note цієї фази.

Допустимі статуси:

- `Planned`
- `In progress`
- `Blocked`
- `Done`
- `Deferred`

Правила:

- одночасно лише одна фаза має бути `In progress`;
- `Done` без verification не ставиться;
- якщо фаза свідомо закінчена частково, але хвіст переноситься в наступний план, вона маркується `Deferred`, а не `Done`.

## 9. Initial execution order

Рекомендований порядок такий:

1. `P0`
freeze current-state, naming law, scope boundaries

2. `P1`
створити feature module `frontend/src/pages/patients/` і зробити thin route entries для `patients/index.ts` та `patients/detail-entry.ts`

3. `P2`
винести pure layer з `patients.tsx`, `patient-detail.tsx`, `patient-detail.helpers.ts`, `patients.helpers.ts`

4. `P3`
винести list/detail fetch flows, assignments, preview/stateful mutations у `data` hooks

5. `P4`
винести patient-local style/binding logic з `patient-form-primitives.tsx`, detail sections і sheet/dialog surfaces

6. `P5-P6`
різати list і detail UI на feature-local modules

7. `P7`
lazy/on-demand pass, rerender/memory cleanup

8. `P8`
final validation + tracker normalization

## 10. Change log

| Date | Phase | Note | Verification |
|------|------|------|------|
| `2026-04-22` | `P0` | Створено канонічний tracker для `patients` refactor cycle. Зафіксовано current-state monolith inventory: `patients.tsx` ~`1803` рядки, `patient-detail.tsx` ~`5481` рядків, плюс pending cleanup для `patient-form-primitives.tsx` і `patient-workspace-nav.tsx`. | local code inspection |
| `2026-04-22` | `P1` | Створено `frontend/src/pages/patients/` і перенесено route monoliths у `list-page.tsx` та `detail-page.tsx`. Старі `patients.tsx` і `patient-detail.tsx` повернуті як thin adapters для збереження route/import contract. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P2` | Стартував pure-layer split: `patients.helpers.ts` і `patient-detail.helpers.ts` перенесені в `patients/model/list-model.ts` та `patients/model/detail-model.ts`, а старі шляхи лишені як compatibility adapters. `list-page.tsx` і `detail-page.tsx` уже споживають новий `model/*` напряму. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P3` | Стартував `data` split для list stack: `use-patients-list-data.ts` виніс provider/doctor/patients fetch flow, `use-patient-detail-sheet-data.ts` виніс detail + assignments + staff loading для patient side-sheet, а `patient-mutations.ts` забрав create/update/archive/assign transport з `list-page.tsx`. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P3` | Продовжив `data` split для detail route: core patient load винесений у `use-patient-detail-core-data.ts`, а базові medical resource types винесені в `model/detail-resource-types.ts`. `detail-page.tsx` більше не тримає inline root fetch/effect для `detail/assignments/staff/vitals/card entries/medical orders/risk scores`. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P3` | Винесено detail tab data layer у `use-patient-detail-tab-data.ts` і `model/detail-tab-types.ts`. `detail-page.tsx` більше не тримає inline fetch/effect для `relations/cases/orders/appointments/documents/contracts/invoices/workflow/timeline`; tab loading і resource hydration тепер ідуть через feature-local data hook. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P3` | Винесено detail mutation transport у `data/patient-detail-mutations.ts`, а `detail-page.tsx` і patient sheets переведені на data-layer для profile update, relations, document upload, workflow actions, contract/invoice status, dunning, compliance export, label payload, medical-order lifecycle і assignment revoke. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P3` | Завершено route-level data extraction: relation patient lookup винесений у `use-patient-lookup-options.ts`, invoice dunning feed винесений у `use-patient-invoice-dunning-events.ts`, а `detail-page.tsx` більше не імпортує `apiFetch` напряму. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | Стартував detail UI pre-split: form-state і pure sheet mappers для profile/relation/document flows винесені в `model/sheet-forms.ts`, щоб наступним проходом різати `patient-detail` sheets у `patients/ui/*` без залежності на route monolith. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | Винесено relation і document-upload editor surfaces у `ui/sheets/patient-relation-editor-sheet.tsx` та `ui/sheets/patient-document-upload-dialog.tsx`. `detail-page.tsx` більше не тримає ці два inline editor blocks і лише монтує feature-local sheet modules. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | Винесено profile editor у `ui/sheets/patient-profile-editor-sheet.tsx`, а shared legal status indicator у `ui/shared/legal-status-pill.tsx`. Після цього три найбільші patient editor sheet-и вже сидять поза route monolith; `detail-page.tsx` зменшився до ~`4169` рядків. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | Добито feature-local import graph: `patients` pages перестали споживати власні compatibility wrappers з `components/*` і root `pages/*`. `patient-form-primitives`, `patients.columns`, `patient-appointments`, `patient-legal-status`, `patient-portal.shared` і patient portal page implementations винесені в `frontend/src/pages/patients/*`, а старі шляхи лишені як thin adapters для route/import compatibility. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | Продовжено detail UI split: `curators` і `relations` tabs винесені в `ui/sections/patient-operations-sections.tsx`, а `detail-page.tsx` зменшився до ~`4027` рядків. Паралельно patient portal implementations (`dashboard/documents/invoices/services/privacy`) теж переведені в `frontend/src/pages/patients/*` з thin root adapters. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | Розширено `patient-operations` cluster: `cases`, `orders` і `appointments` tabs також винесені в `ui/sections/patient-operations-sections.tsx`. Після цього `detail-page.tsx` опустився до ~`3943` рядків, а route module ще менше тримає inline tab composition. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | Прибрано patient clutter з root `src/pages`: `patients.tsx` замінено на feature-local [index.ts](/c:/Users/123/Downloads/dev/frontend/src/pages/patients/index.ts), `patient-detail.tsx` переїхав у [detail-entry.ts](/c:/Users/123/Downloads/dev/frontend/src/pages/patients/detail-entry.ts), а всі legacy adapters/tests зібрані в `frontend/src/pages/patients/compat/*`. Після цього root `pages` більше не містить змішаного набору `patient-*` файлів. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | Прибрано patient clutter з root `src/components`: compatibility wrappers для `patient-*` sheets, `form-primitives` і `workspace-nav` зібрані в `frontend/src/components/patients/compat/*`, а `patients` pages і `app-shell` переведені на feature-local imports. Після цього root `components` більше не містить змішаного набору `patient-*` файлів. | `frontend npm run lint`; `frontend npm run build`; root inventory via `Get-ChildItem frontend/src/components -File` |
| `2026-04-22` | `P6` | `documents/contracts/invoices` винесені з `detail-page.tsx` у `ui/sections/patient-legal-sections.tsx`, а `WorkspaceSectionIntro` винесений у `ui/shared/workspace-primitives.tsx`. Після цього `detail-page.tsx` опустився до ~`3662` рядків і більше не тримає inline legal tab cluster. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | `workflow` tab винесений з `detail-page.tsx` у `ui/sections/patient-workflow-section.tsx`. Після цього route module перестав тримати inline checklist/workflow-form cluster і опустився до ~`3432` рядків. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | `timeline` tab винесений з `detail-page.tsx` у `ui/sections/patient-timeline-section.tsx`. Після цього `detail-page.tsx` опустився до ~`3177` рядків і вже не тримає inline timeline filters/list/grouped events cluster. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | Найбільший `profile` cluster винесений з `detail-page.tsx` у `ui/sections/patient-profile-section.tsx`, включно з legal preview sheets, clinical surface blocks, vitals/card log/medical orders/risk scores і notes surface. Після цього route module перестав тримати головний inline intake/clinical profile block. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | Contract/invoice management overlays винесені з `detail-page.tsx` у `ui/sheets/patient-financial-dialogs.tsx`. `detail-page.tsx` більше не тримає inline contract create sheet, contract status dialog і invoice+dunning dialog cluster. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | Після нового проходу `detail-page.tsx` зменшився до ~`2133` рядків. Поточний build baseline: `patients` `98.52 kB / 26.08 kB gzip`, `detail-entry` `208.56 kB / 50.14 kB gzip`; неблокуючий Vite warning лишається тільки по великому `index` chunk. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-22` | `P6` | Detail workspace composition винесений з route module в `ui/workspace/patient-detail-workspace-content.tsx` і `ui/workspace/patient-detail-overlay-layers.tsx`. `detail-page.tsx` тепер монтує feature-local workspace shell замість inline tab/overlay composition і зменшився до ~`2028` рядків. Актуальний build baseline: `patients` `98.52 kB / 26.08 kB gzip`, `detail-entry` `219.35 kB / 51.44 kB gzip`. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-23` | `P5` | Стартував list UI split: create flow винесений у `ui/sheets/create-patient-sheet.tsx`, split-pane detail sheet у `ui/sheets/patient-list-detail-sheet.tsx`, shared patient form fields у `ui/shared/patient-form-fields.tsx`, а pure presentation formatters у `model/list-formatters.ts`. Після цього `list-page.tsx` зменшився до ~`780` рядків і став значно тоншим orchestration shell. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-23` | `P5` | Продовжено list UI split: toolbar винесений у `ui/list/patients-list-toolbar.tsx`, shortcuts modal у `ui/list/patients-shortcuts-dialog.tsx`, а split/data-table surface у `ui/list/patients-table-surface.tsx`. Після цього `list-page.tsx` зменшився до ~`523` рядків. Актуальний build baseline: `patients` `100.93 kB / 26.99 kB gzip`, `detail-entry` `219.34 kB / 51.44 kB gzip`. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-23` | `P5` | Route-level list orchestration дочищений у feature-local hooks: `ui/hooks/use-patients-list-view-state.ts` тримає URL/table session state, `ui/hooks/use-patient-detail-sheet-session.ts` тримає assignment session, `ui/hooks/use-patients-list-table-model.ts` забирає derived table model, а `data/use-patients-list-actions.ts` забирає optimistic archive toggle. Після цього `list-page.tsx` опустився до ~`365` рядків. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-23` | `P7` | Стартував list-side perf pass: create sheet, split-pane detail sheet і shortcuts dialog тепер відкриваються через lazy/on-demand path з preload перед open. Актуальний build baseline: `patients` `82.36 kB / 23.43 kB gzip`, `detail-entry` `219.44 kB / 51.50 kB gzip`; неблокуючий warning лишається тільки по глобальному `index` chunk. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-23` | `P7` | Hidden detail tabs винесені на lazy/on-demand path у `ui/workspace/patient-detail-workspace-content.tsx`: `profile`, operations cluster, legal cluster, `workflow` і `timeline` тепер вантажаться тільки для активного таба, а preload іде на switch tab. Після цього `detail-entry` впав до `96.67 kB / 25.90 kB gzip`. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-23` | `P7` | Detail overlay/dialog cluster винесений на on-demand mount через lazy `patient-detail-overlay-layers`. Profile/relation/document/financial overlays більше не сидять у cold `detail-entry` route chunk. Новий build baseline: `patients` `82.60 kB / 23.54 kB gzip`, `detail-entry` `56.37 kB / 16.53 kB gzip`; overlay cluster живе окремим async chunk `patient-detail-overlay-layers` `40.07 kB / 10.44 kB gzip`. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-23` | `P7` | Detail render/effect path дочищений: timeline, legal і invoice derived loops більше не крутяться поза активними табами, timeline URL sync effects теж gated по `activeTab`, а lazy overlay chunk preload-иться на open handler-и для profile/relation/document/financial flows. Це майже не змінює bundle baseline (`detail-entry` ~`56.80 kB / 16.72 kB gzip`), але прибирає зайвий non-visible work і холодну затримку першого overlay open. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-23` | `P7` | `patient-profile-section.tsx` переведений на on-demand sheet/preview path: legal/documents/contracts/invoices preview sheets, legal status, vitals, cave notes, card entry, medical order, risk score і notes editor більше не сидять у дефолтному profile chunk. `patient-profile-section` впав до `28.18 kB / 6.96 kB gzip`, а editor/preview chrome розрізаний на окремі async chunks (`patient-legal-preview-sheets`, `patient-vitals-sheet`, `patient-medical-order-sheet`, `patient-risk-score-sheet`, `patient-notes-sheet` тощо). | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-23` | `P7` | Overlay cluster розрізаний ще глибше: `patient-detail-overlay-layers.tsx` тепер лише on-demand router для окремих async dialog chunks (`patient-profile-editor-sheet`, `patient-relation-editor-sheet`, `patient-document-upload-dialog`, `patient-financial-dialogs`) і більше не тягне весь edit stack однією пачкою. Новий overlay router chunk: `patient-detail-overlay-layers` `5.51 kB / 1.75 kB gzip`. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-23` | `P7` | Legal top-level tabs більше не ділять один module: `documents`, `contracts` і `invoices` винесені в `ui/sections/patient-documents-tab.tsx`, `patient-contracts-tab.tsx`, `patient-invoices-tab.tsx` і preload-яться окремо через `patient-detail-workspace-content.tsx`. Нові async chunks: `patient-documents-tab` `9.86 kB / 3.54 kB gzip`, `patient-contracts-tab` `4.96 kB / 2.15 kB gzip`, `patient-invoices-tab` `5.23 kB / 2.21 kB gzip`. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-23` | `P7` | Operations top-level tabs теж переведені на leaf-level async split: `curators`, `relations`, `cases`, `orders`, `appointments` винесені в окремі section modules, а `patient-appointment-sheet` тепер монтується on-demand всередині свого tab surface. Нові async chunks: `patient-curators-tab` `3.60 kB / 1.55 kB gzip`, `patient-relations-tab` `2.95 kB / 1.24 kB gzip`, `patient-cases-tab` `1.38 kB / 0.70 kB gzip`, `patient-orders-tab` `1.49 kB / 0.73 kB gzip`, `patient-appointments-tab` `3.70 kB / 1.65 kB gzip`, `patient-appointment-sheet` `7.10 kB / 2.40 kB gzip`. Актуальний baseline після табового split: `patients` `82.78 kB / 23.59 kB gzip`, `detail-entry` `57.38 kB / 16.78 kB gzip`. | `frontend npm run lint`; `frontend npm run build` |
| `2026-04-23` | `P8` | Стартував final validation pass: patient compat unit-tests зелені (`33` assertions), а targeted browser smoke для staff/patient profile теж зелений. Verification покриває list route, patient profile RBAC shell і пов’язаний staff navigation path. Residual tails після smoke: dev-console noise з chart width warnings і `Received NaN for the children attribute` поза безпосереднім `patients` refactor scope. | `frontend npm run test -- src/pages/patients/compat/patients.helpers.test.ts src/pages/patients/compat/patient-detail.helpers.test.ts src/pages/patients/compat/patient-legal-status.test.ts`; `frontend npm run test:e2e -- tests/e2e/staff-smoke.spec.ts` |
