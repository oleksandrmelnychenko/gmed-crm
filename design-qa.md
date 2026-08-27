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
