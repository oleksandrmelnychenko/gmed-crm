# Design QA — diagnosis specialization column

- Source visual truth: `C:\Users\oleks\AppData\Local\Temp\codex-clipboard-2e760ab3-cb85-4c68-9242-515b2710fd23.png`
- Implementation screenshot: `C:\Users\oleks\OneDrive\Documents\ChatGPT\gmed\diagnosis-specializations-column.png`
- Source pixels: 1819 × 395
- Implementation pixels: 1280 × 720 at a 1280 × 720 CSS viewport, device scale factor 1
- Density normalization: none; both captures are 1× desktop raster images
- State: patient clinical tab with the diagnosis list visible and the same first diagnosis selected in neither capture

## Full-view comparison evidence

The source identifies the diagnosis card and the specialization chips that need repositioning. The implementation intentionally differs from the source at the requested point: the specialization chips are now a dedicated middle column between diagnosis details and row actions, rather than a vertical block below the title. Card borders, state colors, typography, buttons, and compact pill styling remain consistent with the existing product.

## Focused region comparison evidence

The first diagnosis row was checked at desktop width. The title/status content stays in the first grid track, the two amber specialization chips occupy the second track, and add/edit/delete actions stay in the final track. At narrower desktop width the long diagnosis wraps within its own track without overlapping either specialization or action controls. A focused crop was not required because the implementation screenshot keeps the complete first diagnosis row readable at native scale.

## Required fidelity surfaces

- Fonts and typography: existing Onest/Geist application typography, weights, sizes, and line heights are unchanged.
- Spacing and layout rhythm: the new middle track uses the existing 12 px grid gap and aligns chips to the top of the diagnosis row.
- Colors and visual tokens: existing amber specialization, sky diagnosis, teal confirmation, and muted action tokens are unchanged.
- Image quality and assets: no new raster, logo, illustration, or custom icon assets were introduced.
- Copy and content: diagnosis, specialization, state, and action labels are unchanged.

## Findings

- No actionable P0, P1, or P2 differences remain for the requested specialization-column change.

## Interaction and runtime checks

- Patient clinical route rendered successfully against the local development server.
- The diagnosis row actions remained visible and interactive after the layout change.
- Browser console contained only Vite connection messages and the React DevTools development notice; no errors or warnings.
- Focused Vitest suite: 17/17 passed.
- Production frontend build passed.

## Comparison history

- Initial issue: specialization chips rendered below the diagnosis title and made the text column visually taller.
- Fix: introduced a responsive three-track diagnosis row (`details | specializations | actions`) with a single-column fallback below the large breakpoint.
- Post-fix evidence: `diagnosis-specializations-column.png` shows both amber chips in the dedicated middle column without overlap.

## Follow-up polish

- None required for this change.

final result: passed

---

# Design QA — role dashboards

- Source visual truth: `C:\Users\oleks\OneDrive\Documents\ChatGPT\gmed\role-dashboard-source-ceo.png`
- Implementation screenshot: `C:\Users\oleks\OneDrive\Documents\ChatGPT\gmed\role-dashboard-concierge.png`
- Source pixels: 1280 × 720
- Implementation pixels: 1280 × 720 at a 1280 × 720 CSS viewport, device scale factor 1
- Density normalization: none; both captures use the same desktop viewport and raster density
- State: authenticated Russian interface; existing CEO dashboard used as the product-style reference, Concierge role preview used as the rendered implementation

## Full-view comparison evidence

The Concierge dashboard preserves the existing GMED console shell, typography, white canvas, neutral borders, compact KPI density, orange active accents, and restrained elevation of the CEO reference. The information architecture is intentionally role-specific: four primary KPIs, two supporting metrics, a three-item daily focus list, and permitted quick links replace the CEO-only charts and demographic sections.

## Focused region comparison evidence

The KPI row and the two-column work area were checked at native scale. Metric labels, values, hints, Lucide icons, card borders, orange markers, section headers, and list dividers remain readable and aligned without wrapping into adjacent tracks. A separate crop was not needed because the complete above-the-fold dashboard is readable in both 1280 × 720 captures.

## Required fidelity surfaces

- Fonts and typography: the existing application font family, compact labels, semibold headings, numeric hierarchy, and line heights are reused without introducing a new display style.
- Spacing and layout rhythm: the dashboard follows the existing content margins and four-column desktop grid; supporting panels share a consistent border, radius, header height, and divider rhythm.
- Colors and visual tokens: white surfaces, neutral gray borders/text, and the product's orange accent are reused. No peach background islands, decorative gradients, or heavy shadows were introduced.
- Image quality and assets: no raster illustrations or custom SVG assets were required. Existing Lucide interface icons and the product logo remain unchanged.
- Copy and content: role names, metric labels, hints, daily actions, and quick-link descriptions are localized in Russian and German and are specific to each role's operational scope.

## Findings

- No actionable P0, P1, or P2 differences remain for the role-dashboard implementation.
- The CEO navigation shown in the Concierge screenshot is an intentional development-only preview constraint: the query parameter changes dashboard content without impersonating or mutating the authenticated account. Production navigation continues to be derived from the signed-in user's role.

## Interaction and runtime checks

- CEO dashboard remains on the existing executive implementation.
- Concierge and IT Admin role previews rendered with complete KPI, focus, and supporting-metric content.
- Concierge quick links were limited to route-access entries returned for that role; legacy roles receive no business quick links.
- Browser-rendered DOM contained no Vite/React error overlay or failed dashboard state during the checked role transitions.
- Full frontend suite passed: 95 test files, 735 tests.
- Full ESLint, staff-navigation guard, and TypeScript project build passed.
- Production Vite build passed; the generated verification bundle was removed after inspection.

## Comparison history

- Initial P2: the Concierge supporting-metrics row had an unused wide slot because the role exposed one fewer metric than the shared layout expected.
- Fix: added the service-taxonomy metric and matching preview payload so both supporting cells render with balanced density.
- Post-fix evidence: `role-dashboard-concierge.png` shows `Оценка сервиса` and `Направления сервиса` filling the complete supporting-metrics panel without an empty track.

## Follow-up polish

- None required for this release.

final result: passed

---

# Design QA — clinical document import header tabs

- Source visual truth: `C:\Users\oleks\AppData\Local\Temp\codex-clipboard-ef9be86a-8421-45f8-9fae-8b70ac9ddd49.png`
- Implementation screenshot: `C:\Users\oleks\AppData\Local\Temp\gmed-clinical-import-full.png`
- Source pixels: 2245 × 84
- Implementation pixels: 1514 × 1272 at a 1514 × 1272 CSS viewport, device scale factor 1.5
- Density normalization: the source is a focused header crop; the implementation was reviewed at its native desktop viewport with the full top region visible. No pixel resampling was used.
- State: Russian interface, ready-for-review import with seven extracted objects, all candidates selected

## Full-view comparison evidence

The implementation removes the old split workspace header containing the history action, filename, status, page label, and active-category badge. A single full-width tab row now spans the builder above both the review and document-preview columns. The row order is `Полный текст`, `Все`, `Диагнозы`, `Анамнез`, `Медикаменты`, `Обследования`, `Анализы`, `Рекомендации`. Each section uses the same segmented wizard treatment as the lead wizard, with a circular Lucide icon, vertical divider, active background, and brand underline.

## Focused region comparison evidence

The source header crop and the browser-rendered implementation were opened together. The requested replacement is visible in the implementation full view: none of the removed filename/status/page elements remains in the workspace row, and every requested tab is readable without horizontal overflow at the tested desktop width. A separate browser clip was not used as final evidence because the in-app browser clip API did not preserve the requested transformed-dialog offset; the uncropped viewport keeps the complete header region readable.

## Required fidelity surfaces

- Fonts and typography: the existing application font, tab weight, size, and active orange emphasis remain unchanged; only `Весь текст` was clarified to `Полный текст`.
- Spacing and layout rhythm: the new 56 px row gives the icon-and-label treatment more breathing room and spans both workspace columns; the border above the row is removed while the lower separator is preserved.
- Colors and visual tokens: existing neutral border/background and orange active-tab/count tokens are unchanged.
- Image quality and assets: no image, logo, illustration, custom SVG, or replacement asset was introduced.
- Copy and content: tab labels use the existing Russian/German localization path; the removed operational labels no longer duplicate information inside the builder.

## Findings

- No actionable P0, P1, or P2 differences remain for the requested header replacement.

## Interaction and runtime checks

- `Полный текст` opens the complete extracted text view.
- `Диагнозы` opens the diagnosis section; the remaining category tabs retain their existing state and counts.
- The global source-country field and its warning are absent from the review workspace.
- The 1514 px viewport has no document-level horizontal overflow, and the tab list has no overflow at that width while retaining horizontal scrolling for narrower screens.
- Browser console: no errors.
- Targeted ESLint: passed.
- TypeScript project build: passed.

## Comparison history

- Initial issue: a split filename/status/page header duplicated context and consumed vertical space while category tabs lived in a separate row inside the left column.
- Fix: promoted the tabs to one shared workspace row, reordered them with full text first, removed the split preview header and global source-country warning, then matched the segmented icon treatment used by the lead wizard.
- Post-fix evidence: `gmed-clinical-import-full.png` shows the unified tab row above both columns with the old header absent.

## Follow-up polish

- None required for this change.

final result: passed

---

# Design QA — CRM login localization and Mollie

- Source screenshot: `C:\Users\oleks\AppData\Local\Temp\gmed-login-localization-qa\reference.png`
- Implementation screenshot: `C:\Users\oleks\AppData\Local\Temp\gmed-login-localization-qa\implementation-viewport-2.png`
- Full comparison: `C:\Users\oleks\AppData\Local\Temp\gmed-login-localization-qa\comparison.png`
- Focused Mollie hover comparison: `C:\Users\oleks\AppData\Local\Temp\gmed-mollie-orange-qa\comparison-hover.png`
- Source pixels: 1265 × 712; implementation pixels: 1280 × 720
- Density normalization: implementation was normalized to 1265 × 712 for the side-by-side comparison
- State: unauthenticated Russian login; Mollie control focused/hovered for the focused comparison

## Full-view comparison evidence

The CRM keeps the website login's centered brand, soft gray background, white card, rounded inputs, dark primary action, home link, confidentiality note, orange Mollie action, trust copy, and language control. Console-specific email authentication and operational copy remain intentional product differences.

## Focused region comparison evidence

The lower card region was compared separately after activating the Mollie link state. The CRM now uses the website's exact Mollie orange transition, `#ff8c00 → #e67700`, with white text. Normal, visited, hover, focus, and active states no longer introduce a red token.

## Required fidelity surfaces

- Fonts and typography: existing CRM typography remains in use and follows the reference hierarchy and compact uppercase brand treatment.
- Spacing and layout rhythm: card padding, vertical grouping, separators, and CTA widths match the source pattern.
- Colors and visual tokens: gray page, white card, dark login CTA, muted copy, and orange Mollie CTA are preserved.
- Image quality and assets: the supplied GMED logo remains a real raster brand asset; Lucide icons are used for interface controls.
- Copy and content: every visible and accessibility-facing login string is localized in Russian and German.

## Localization and interaction checks

- `lang=ru` renders Russian.
- `lang=de`, `lang=en`, and `lang=es` render German, matching the website handoff contract.
- A URL language parameter sets the initial language once; the RU/DE switch remains interactive afterward.
- Password show/hide aria labels change with the active language and state.
- Website `auth` catalogs for DE/EN/RU/ES contain the same 17 non-empty keys.
- Mollie button and trust link both target `https://www.mollie.com/` with safe external-link attributes.
- Browser console: no errors or warnings after clean reloads and interaction checks.
- Targeted Vitest suite: 7/7 passed.
- Targeted ESLint: passed.
- TypeScript and production Vite build: passed.

## Comparison history

- Initial P1: URL language effect reapplied on every language change and could undo a manual RU/DE switch.
- Initial P2: brand tagline, home link, and password-toggle aria labels remained hardcoded in English.
- Initial P2: Mollie hover did not explicitly override inherited link states.
- Fix: localized all login-facing copy, applied the incoming locale once, added coverage for RU/DE/EN/ES mapping, and pinned normal/visited/hover/active Mollie colors to orange variants.
- Follow-up P2: the flat `#f58200` fill still looked too red compared with the website's Mollie control.
- Follow-up fix: copied the source control's exact `#ff8c00 → #e67700` orange transition and replaced the red-orange focus ring with `rgb(255 140 0 / 28%)`.
- Post-fix evidence: `gmed-mollie-orange-qa/comparison-hover.png` shows the revised orange state beside the website reference.

## Findings

- No actionable P0, P1, or P2 differences remain for the requested localization and Mollie states.

final result: passed
