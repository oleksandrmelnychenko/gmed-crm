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
