# Frontend Patients Workspace Refactor Tracker (UA)

> Канонічний tracker для наступного frontend-рефактора: `record-workspace -> patients split`.
>
> Цей документ продовжує підхід із `03_frontend-workspace-refactor-plan_ua.md`, але вже для `patients` list/detail stack. Він є source of truth для фаз, scope, performance goals і tracking protocol цього циклу.

## 1. Статус

- Поточний статус: `In progress`
- Активна фаза: `P6`
- Scope: staff frontend patients workspace
- Review context: `2026-04-22`

## 2. Поточний зріз

Поточний `patients` slice уже частково сидить на новому shared vocabulary, але архітектурно ще не доведений до того самого рівня, що `appointments`.

Актуальні больові точки:

- [index.ts](/c:/Users/123/Downloads/dev/frontend/src/pages/patients/index.ts) уже thin route adapter; головний list monolith перенесений у [list-page.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/patients/list-page.tsx), зараз близько `1669` рядків.
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
| `P5` | `Planned` | list UI split | table/list/create/detail-sheet surfaces розбиті на feature-local UI modules |
| `P6` | `In progress` | detail UI split | patient detail workspace, tabs, sheets, dialogs і section blocks винесені з `patient-detail.tsx` |
| `P7` | `Planned` | Performance hardening | hidden tabs і heavy preview/dialog flows lazy-load, detail state локалізований |
| `P8` | `Planned` | Final validation | lint/build/test green, targeted e2e sanity green, residual tails documented |

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
