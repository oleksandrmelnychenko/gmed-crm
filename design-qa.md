# Design QA — Medication AI result dialog

## Evidence

- Source visual truth: `C:/Users/oleks/Developer/gmed/design-qa-artifacts/medication-ai-before.jpg`
- Implementation screenshot: `C:/Users/oleks/Developer/gmed/design-qa-artifacts/medication-ai-after.jpg`
- Supporting evidence-tab screenshot: `C:/Users/oleks/Developer/gmed/design-qa-artifacts/medication-ai-evidence-tab.jpg`
- Route: `http://127.0.0.1:5173/patients/ef0131a4-8f84-458a-a7c0-5de552a0a2e4?tab=medication-ai`
- Viewport: 1461 × 1272 CSS px, device pixel ratio 1.5.
- Captures: 1461 × 1272 px JPEG, normalized to the same browser viewport and density.
- State: same patient, same evidence review, same synthetic DEV AI result. The source capture is scrolled to the old AI section; the implementation capture shows the new default AI-first state from its header.

## Full-view comparison

The source modal presents deterministic evidence, snapshot, provenance, AI summary, verification questions, limitations, and every citation link as one continuous report. The revised modal separates the two reading modes into `AI-результат` and `Доказательства`, keeps only the short AI conclusion expanded by default, and collapses supporting questions, limitations, and multi-source groups. The dialog now sizes to its useful content instead of occupying the full available height.

## Focused comparison

The full-view captures are readable enough to compare hierarchy, density, typography, spacing, and source controls. The supporting evidence-tab capture verifies the secondary state: deterministic summary remains visible while questions, limitations, snapshot, and all sources are independently expandable.

## Required fidelity surfaces

- Fonts and typography: existing GMED font families, sizes, weights, and muted hierarchy are preserved. The new tabs, pills, section titles, counts, and body copy use existing product tokens and do not introduce a new visual language.
- Spacing and layout rhythm: the old single-column report is replaced by a compact header, one overview row, and a 1.3/0.7 AI content grid. Repeated vertical gaps and nested section headers are removed. The dialog uses content-driven height with a bounded scroll area for the longer evidence state.
- Colors and tokens: existing white, muted, border, amber safety, sky date, emerald status, and orange AI accents are retained. No gradients or new palette values were introduced.
- Image and asset fidelity: the dialog contains no raster imagery. Existing `AiMark`, status dots, and the product's icon library are reused; no placeholder or handcrafted visual assets were added.
- Copy and content: medical safety text and all evidence remain intact. Labels are shortened to `Краткий вывод`, `Что проверить`, and `Ограничения`, while deterministic evidence is moved to its own tab rather than removed.

## Comparison history

### Pass 1 — blocked

- [P1] No reading hierarchy: every evidence and AI section was expanded in one continuous modal.
- [P2] Citation controls repeated once per source, creating rows of visually identical buttons.
- [P2] The first compact implementation used a fixed tall dialog, leaving a large unused white area below the result.

Fixes applied:

- Added AI/evidence tabs and made the AI result the default state.
- Kept only the short conclusion expanded; made questions and limitations progressive disclosure sections.
- Collapsed multiple citations into one `Источники · N` control while keeping each link accessible after expansion.
- Reduced seven statistic tiles to four compact overview pills.
- Replaced fixed dialog height with content-driven height plus bounded overflow for long states.

### Pass 2 — passed

- AI tab, evidence tab, question expansion, and grouped-source expansion were tested in the in-app browser.
- No clipped content, horizontal overflow, broken controls, or actionable P0/P1/P2 visual issues remain at the captured desktop viewport.
- Targeted component tests: 9 passed.
- TypeScript project check and ESLint check passed.

## Follow-up polish

- [P3] Validate the same dialog on a physical narrow Android viewport during the later mobile QA pass.

final result: passed

---

# Design QA — Readable disabled OCR laboratory fields

## Evidence

- Source visual truth: `C:/Users/oleks/AppData/Local/Temp/codex-clipboard-d37cd9ec-4ab9-423a-aab9-f1e40955fdb5.png` (1507 × 649 px).
- Implementation screenshot: `C:/Users/oleks/Developer/gmed/design-qa-clinical-import-disabled-viewport.png` (1652 × 1272 px).
- Route: `http://127.0.0.1:5173/patients/ef0131a4-8f84-458a-a7c0-5de552a0a2e4?tab=clinical`.
- Viewport: 1652 × 1272 CSS px, device pixel ratio 1.5; browser capture is 1652 × 1272 px.
- State: OCR import review open, Hämoglobin laboratory candidate unchecked and its editor controls disabled.

## Full-view and focused comparison

The source shows the entire unchecked laboratory card faded, including the parameter name and populated values. The implementation keeps the disabled controls and muted field backgrounds, but removes card-level opacity and renders populated values in the normal foreground color. The Hämoglobin name, result, unit, date, group, and status remain readable while the checkbox continues to communicate exclusion. The full browser capture is sufficiently sharp to inspect the affected field typography; no additional focused crop is needed.

## Required fidelity surfaces

- Fonts and typography: existing GMED family, weights, sizes, and uppercase field labels are unchanged; disabled values now use the same readable foreground tone as enabled values.
- Spacing and layout rhythm: field grid, card padding, gaps, radii, and editor height are unchanged.
- Colors and visual tokens: only disabled-value contrast changed. Muted backgrounds and placeholder styling remain, while populated disabled values use `text-foreground` at full opacity.
- Image and asset fidelity: this form contains no raster assets; existing controls and icons are unchanged.
- Copy and content: no labels, values, OCR metadata, or actions were changed.

## Comparison history

### Pass 1 — blocked

- [P1] The whole unchecked card used reduced opacity, making the parameter name and populated values difficult to read.
- [P2] The disabled MUI date field retained its own gray text color after the card opacity was removed.

Fixes applied:

- Removed card-level opacity for unchecked non-medication candidates.
- Kept the controls disabled while forcing populated input, select, textarea, and date-section text to the normal foreground color at full opacity.

### Pass 2 — passed

- Browser inspection confirmed `Hämoglobin` remains disabled with computed opacity `1`, card opacity `1`, and foreground color `oklch(0.17 0 0)`.
- Disabled date sections resolve to the same foreground color.
- Checkbox selection still toggles the disabled state correctly.
- No browser console errors were recorded.

## Follow-up polish

- No P0/P1/P2 issues remain for this requested state.

final result: passed

---

# Design QA — Optional order for Concierge expense review

## Evidence

- Source visual truth: `C:/Users/oleks/AppData/Local/Temp/codex-clipboard-c272d7e1-62b2-45dd-a6a7-6e2547924c5b.png`
- Implementation screenshot: `C:/Users/oleks/Developer/gmed/design-qa-artifacts/concierge-expense-optional-order-after.png`
- Route: `http://127.0.0.1:5173/company-finance?tab=concierge-expenses`
- State: the same pending Alexandra Grau / The Alpina Gstaad expense with no submitted order.

## Comparison

- The order field remains available, but its required marker is removed and `Необязательно` is shown in the label row.
- The order-required warning no longer renders when the empty option is selected.
- `Подтвердить и провести` is enabled with no order selected; choosing an order still enables the dependent order-position selector.
- The header copy no longer describes order assignment as a mandatory review step.
- Existing modal spacing, type scale, borders, controls, financial summary, rejection flow, and history layout remain unchanged.

## Verification

- DOM inspection confirmed the empty order selection, optional label, absent warning, and enabled approval action.
- The source and implementation captures were reviewed together. No clipped controls, overlap, layout shift, or actionable P0/P1/P2 visual issue remains.
- Targeted component tests: 5 passed.
- TypeScript project check and targeted ESLint check passed.

final result: passed
