# Frontend Workspace Refactor Plan (UA)

> Канонічний tracker для рефактора `app-shell -> record-workspace -> feature modules` у frontend.
>
> Цей файл є робочим source of truth для:
>
> - розбиття `frontend/src/pages/appointments.tsx`;
> - винесення shared workspace vocabulary з patient-driven current state;
> - нормалізації `src/components/layout.tsx` у окремий `app-shell` layer;
> - performance, memory і bundle-size оптимізації для staff workspace.

## 1. Статус

- Поточний статус: `Planned`
- Owner: `Codex + user`
- Останній review context: `2026-04-21`

## 2. Основна мета

Перебудувати frontend так, щоб:

- глобальна оболонка застосунку жила в окремому `app-shell` layer;
- shared workspace pattern жив у нейтральному `record-workspace` layer;
- `patients`, `appointments`, `cases` стали consumer-features, а не неформальними master-файлами;
- `appointments` перестав бути монолітним page-module;
- hidden tabs і heavy right sheets перестали вантажитися eagerly;
- style decisions, workspace shells, feature appearance bindings і data orchestration жили в окремих папках і файлах.

## 3. Scope

У рамках цього рефактора в scope входять:

- [frontend/src/components/layout.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/layout.tsx)
- [frontend/src/components/ui-shell.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/ui-shell.tsx)
- [frontend/src/components/patient-form-primitives.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/patient-form-primitives.tsx)
- [frontend/src/components/appointment-workspace-nav.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/appointment-workspace-nav.tsx)
- [frontend/src/components/patient-workspace-nav.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/patient-workspace-nav.tsx)
- [frontend/src/components/case-workspace-nav.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/case-workspace-nav.tsx)
- [frontend/src/pages/appointments.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/appointments.tsx)
- [frontend/src/pages/patient-detail.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/patient-detail.tsx)
- пов'язані appointment/patient shared helpers, sheets і section components

## 4. Out of Scope

Поза межами цього плану, якщо окремо не буде розширення:

- backend API redesign;
- product-scope зміни до appointment workflows;
- глобальна міграція всіх сторінок проекту на новий shell поза `patients / appointments / cases`;
- перепис на іншу state-management бібліотеку для всього frontend.

## 5. Архітектурний контракт

### 5.1 Layers

Після рефактора діють 4 шари:

1. `app-shell`
2. `record-workspace`
3. `feature appearance + data + model`
4. `feature ui`

### 5.2 Layer responsibilities

`app-shell`

- authenticated application frame;
- topbar, left navigation, workspace rail mounting;
- route-aware shell orchestration;
- route access/loading boundaries.

`record-workspace`

- shared control recipes;
- shared surfaces;
- workspace header/nav/section/sheet shells;
- empty, list, field, stat, banner primitives.

`feature model`

- types, constants, selectors, mappers, query keys;
- zero React imports.

`feature data`

- fetchers, cache, dedupe, tab-specific data loaders;
- no UI imports.

`feature appearance`

- status/timeline/action/section/sheet bindings;
- feature-local style decisions;
- no API or data-fetch logic.

`feature ui`

- scheduler, workspace, sections, sheets;
- only composition from shared shells + model + data + appearance.

## 6. Naming Law

Заборонені generic file names, якщо файл не вузький і не самоочевидний:

- `helpers.ts`
- `utils.ts`
- `styles.ts`
- `common.ts`

Дозволені й рекомендовані суфікси:

- `*-selectors.ts`
- `*-mappers.ts`
- `*-query-keys.ts`
- `*-appearance.ts`
- `*-recipes.ts`
- `*-slots.ts`
- `*-shell.tsx`
- `*-panel.tsx`
- `*-sheet.tsx`

Shared naming:

- `app-shell` для зовнішньої оболонки;
- `record-workspace` для shared workspace language;
- `appearance` для feature visual bindings.

Feature naming:

- не префіксувати всі файли словом `appointments` усередині `src/pages/appointments/`;
- називати файли за реальною роллю: `timeline-panel.tsx`, `editor-sheet-shell.tsx`, `workspace-rail-shell.tsx`.

## 7. Dependency Rules

Правила імпорту після рефактора:

- `model` не імпортує React, `data`, `appearance`, `ui`;
- `data` не імпортує `ui`;
- `appearance` не імпортує `data`;
- `ui` може імпортувати `model`, `data`, `appearance`, shared shells;
- `appointments` не імпортує `patients` UI;
- `patients` не є master-source для shared design;
- глобальний shell не знає деталей feature helpers напряму.

## 8. Target Structure

```text
frontend/src/components/
  app-shell/
    authenticated-app-shell.tsx
    app-shell-frame.tsx
    app-shell-content.tsx
    workspace-rail-resolver.tsx
    workspace-rail-shell.tsx
    app-shell-slots.ts

  record-workspace/
    recipes/
      control-recipes.ts
      surface-recipes.ts
      sheet-recipes.ts
      typography-recipes.ts
    primitives/
      field.tsx
      section-card.tsx
      stat-tile.tsx
      list-row.tsx
      empty-state.tsx
      status-pill.tsx
      banner.tsx
    shells/
      page-header.tsx
      workspace-nav-shell.tsx
      editor-sheet-shell.tsx
      preview-sheet-shell.tsx
      section-intro.tsx

frontend/src/pages/
  appointments.tsx
  appointments/
    page.tsx
    model/
      types.ts
      constants.ts
      selectors.ts
      mappers.ts
      query-keys.ts
    data/
      appointments-api.ts
      use-scheduler-data.ts
      use-detail-core.ts
      use-detail-tab-data.ts
      use-linked-records.ts
    appearance/
      status-appearance.ts
      timeline-appearance.ts
      sheet-appearance.ts
      section-appearance.ts
      action-appearance.ts
      scheduler-slots.ts
      workspace-slots.ts
    ui/
      scheduler/
      workspace/
      sections/
      sheets/
```

## 9. Current-State Risks

Поточні ризики, які цей план закриває:

- `appointments.tsx` є монолітним client module;
- detail page eagerly вантажить таби, які ще не відкривались;
- mobile і desktop detail tree дублюються;
- global `layout.tsx` залежить від feature-specific workspace nav;
- patient-side зараз де-факто виконує роль design master;
- style vocabulary і class decisions розкидані по великих page files;
- right sheets і edit flows не мають єдиного architectural contract.

## 10. Performance Targets

Рефактор вважається успішним тільки якщо дає вимірюваний виграш:

- main `appointments` chunk зменшується від current-state;
- hidden tabs не fetchаться до відкриття;
- heavy sheets lazy-load only on demand;
- відкриття/закриття right sheets не ререндерить весь scheduler shell;
- mobile/desktop detail працюють від одного shared content tree;
- ephemeral preview/detail payloads очищаються на close;
- нові feature files не створюють barrel-import regressions.

## 11. Phase Tracker

| Phase | Status | Deliverable | Done when |
|------|------|------|------|
| P0 | `Planned` | Architecture freeze | Зафіксовані `app-shell`, `record-workspace`, naming law, dependency rules |
| P1 | `Planned` | `app-shell` extraction | `layout.tsx` перестає бути generic dump, shell стає окремим layer |
| P2 | `Planned` | `record-workspace` extraction | `ui-shell` розпиляний на shared recipes/primitives/shells |
| P3 | `Planned` | Workspace rail normalization | `patient/case/appointment` rails сидять на одному shell pattern |
| P4 | `Planned` | Patient-side de-mastering | `patients` споживає shared layer, а не задає його |
| P5 | `Planned` | `appointments/` feature skeleton | route file thin, feature code живе в окремій папці |
| P6 | `Planned` | Pure `model` extraction | types/selectors/mappers/query keys без React |
| P7 | `Planned` | `data` layer split | core/tab data loaders, cache, dedupe, on-demand loading |
| P8 | `Planned` | Shared workspace content | mobile/desktop мають один content tree |
| P9 | `Planned` | `appearance` extraction | status/timeline/sheet/section/action bindings винесені |
| P10 | `Planned` | Scheduler split | scheduler/search/queue/create ізольовані від detail workspace |
| P11 | `Planned` | Section split | overview/timeline/coordination/clinical/workflow/services/notes по окремих panel files |
| P12 | `Planned` | Right-sheet split + lazy | linked sheets і editors винесені й lazy-loaded |
| P13 | `Planned` | Rerender/memory cleanup | state локалізований, hidden work defer-иться, close cleanup зафіксований |
| P14 | `Planned` | Guardrails | lint/import boundary rules захищають нову архітектуру |
| P15 | `Planned` | Final validation | build/lint/tests/perf sanity green, residual debt documented |

## 12. Tracking Protocol

Після кожної суттєвої зміни цей файл треба оновлювати:

- змінити `Status` відповідної фази;
- додати touched files;
- зафіксувати, що саме стало canonical after change;
- додати verification steps;
- за потреби зафіксувати нові ризики або відкладені tails.

Допустимі статуси:

- `Planned`
- `In progress`
- `Blocked`
- `Done`
- `Deferred`

## 13. Execution Rules

Поки цей план активний, діють жорсткі правила:

- не додавати новий великий код у монолітний [appointments.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/appointments.tsx), якщо його можна одразу покласти в нову feature structure;
- не створювати нові shared abstraction у `patients` або `appointments`, якщо вони мають жити в `record-workspace`;
- не додавати нові route-aware branching rules прямо в global shell, якщо їх можна винести в resolver;
- не дублювати desktop/mobile section tree;
- не вантажити hidden tab data upfront без явної причини;
- не використовувати barrel exports для heavy feature areas;
- не змішувати style bindings і business/data logic в одному файлі.

## 14. Phase Detail

### P0. Architecture freeze

Ціль:

- зафіксувати vocabulary, names, folder law і dependency law.

Artifacts:

- цей документ.

### P1. `app-shell` extraction

В scope:

- [frontend/src/components/layout.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/layout.tsx)
- глобальний shell chrome;
- workspace rail mounting;
- route-aware shell resolution.

Очікуваний результат:

- `layout.tsx` стає thin adapter або зникає;
- з'являється чесний `authenticated-app-shell.tsx`;
- feature rails більше не монтуються хаотично прямо в generic shell.

### P2. `record-workspace` extraction

В scope:

- [frontend/src/components/ui-shell.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/ui-shell.tsx)
- shared surfaces, controls, headers, sheets, empty/list/stat patterns.

Очікуваний результат:

- shared design vocabulary більше не залежить від patient pages;
- shared shell names і slot names стають canonical.

### P3. Workspace rail normalization

В scope:

- [frontend/src/components/appointment-workspace-nav.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/appointment-workspace-nav.tsx)
- [frontend/src/components/patient-workspace-nav.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/patient-workspace-nav.tsx)
- [frontend/src/components/case-workspace-nav.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/case-workspace-nav.tsx)

Очікуваний результат:

- один shared rail shell;
- feature-specific лише item configs і labels.

### P4. Patient-side de-mastering

В scope:

- [frontend/src/pages/patient-detail.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/patient-detail.tsx)
- [frontend/src/components/patient-form-primitives.tsx](/c:/Users/123/Downloads/dev/frontend/src/components/patient-form-primitives.tsx)

Очікуваний результат:

- patient flow споживає shared patterns;
- patient files більше не є архітектурним джерелом для інших feature slices.

### P5-P13. `appointments` split and optimization

В scope:

- [frontend/src/pages/appointments.tsx](/c:/Users/123/Downloads/dev/frontend/src/pages/appointments.tsx)
- усі appointment sections, sheets, state orchestration, appearance bindings і data loaders.

Очікуваний результат:

- thin route entry;
- feature-local folders;
- tab-level data loading;
- lazy-loaded heavy editors and previews;
- локалізований state;
- менший bundle і контрольований rerender footprint.

### P14-P15. Guardrails and final validation

В scope:

- lint/import boundaries;
- build/lint/tests;
- bundle/perf sanity;
- residual debt log.

## 15. Verification Baseline

Мінімальна перевірка після кожної великої фази:

- `frontend npm run lint`
- `frontend npm run build`

Додатково для appointment-heavy фаз:

- relevant unit tests
- relevant e2e/live appointment flows
- sanity check mobile detail + linked right sheets + clinical editors

## 16. First Practical Step

Перший execution step після затвердження цього tracker:

- створити `app-shell` і `record-workspace` skeleton без зміни поведінки;
- паралельно зробити thin feature skeleton для `appointments`;
- тільки після цього переносити logic/state/appearance секціями.
