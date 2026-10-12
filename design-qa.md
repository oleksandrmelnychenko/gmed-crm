# Design QA — Patient order overview hierarchy

## Evidence

- Source visual truth: `C:/Users/oleks/AppData/Local/Temp/codex-clipboard-642e29bd-03e7-46e3-b9ca-67a802d903be.png`.
- Implementation capture: live in-app browser verification on `http://127.0.0.1:5173/orders/:orderId?patient=:patientId`.
- State: active patient order in the intake phase with three requirements before execution and two services.

## Comparison

- The header now identifies the record as an order, keeps the patient as the main subject, and shows only the order total, service count, and update timestamp.
- Lifecycle status is presented as the current phase, the next phase, and a numbered list of actions that lead directly to the correct section.
- Pause, completion, and cancellation actions are grouped under `Управление заказом` instead of competing with the primary workflow.
- The overview starts with a structured patient-need card: the primary request, each requested service and its own comment, plus a visible `НУЖЕН ПЕРЕВОДЧИК` marker instead of one unformatted paragraph.
- The planning section explains that an interpreter is assigned to a specific appointment and provides a prominent `Открыть приёмы` action.
- Linked records use compact rows. Finance is reduced to four operational totals, while the accounting breakdown and service economics table remain available in a collapsed disclosure.
- Workspace navigation uses task-oriented labels such as `Главное`, `Что нужно сделать`, `Услуги и стоимость`, and `Счета поставщиков`.

## Verification

- Live desktop inspection confirmed clear visual priority, readable service comments, a visible interpreter requirement, and an unclipped order-management menu.
- The interpreter action and all three actionable blockers are exposed to keyboard and accessibility navigation.
- The compact finance state and the full-report disclosure are both keyboard-accessible native controls.
- TypeScript project check and targeted ESLint check passed.

final result: passed

---

# Design QA — Quote related data and deletion

## Evidence

- Source visual truth: `C:/Users/oleks/AppData/Local/Temp/codex-clipboard-0c9873df-2605-4c50-8953-49de93c0209b.png`.
- Implementation capture: live in-app browser verification on `http://127.0.0.1:5173/contracts?quote=:quoteId`.
- State: rejected quote with patient, order, invoices, documents, and two saved versions.

## Comparison

- The misleading `Привязанные пациенты` heading is now `Связанные данные`.
- Four oversized cards are replaced by compact rows that show the linked patient and order identifiers while retaining direct actions for invoices and documents.
- The unrelated aggregate electronic-signature action is removed from the quote sheet.
- Rejected, draft, and expired quotes expose a destructive `Удалить предложение` action with a focused confirmation dialog. Accepted and sent quotes stay protected.

## Verification

- Live browser inspection confirmed the compact rows, absence of the signature action, visible delete action, and Russian confirmation copy.
- The confirmation was cancelled during visual QA, so the existing DEV quote was not changed.
- The server deletion policy is covered by a targeted integration test for a rejected quote and an accepted quote.
- No clipping, overlap, or actionable P0/P1/P2 issue remains in the sheet.

final result: passed

---

# Design QA — Patient task in-context preview

## Evidence

- Source visual truth: `C:/Users/oleks/AppData/Local/Temp/codex-clipboard-201bc3ab-99c1-4ff7-a632-44d6121d9031.png`.
- Implementation capture: live in-app browser verification on `http://127.0.0.1:5173/patients/:patientId`.

## Comparison and verification

- Clicking any linked task now opens the existing task detail dialog over the patient profile.
- Status, assignee, dates, relations, files, checklist, comments, and history remain available in the dialog.
- The patient URL remains unchanged, preserving the working context. Closing the dialog returns to the same task list position.

final result: passed

---

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

# Design QA — Patient contract preview without context redirect

## Evidence

- Source visual truth: `C:/Users/oleks/AppData/Local/Temp/codex-clipboard-2e5d153f-070e-43f3-9801-167d89b18563.png`.
- Implementation capture: live Chrome verification on `http://127.0.0.1:5173/patients/:patientId?tab=contracts`.
- State: signed framework contract selected from the patient contracts table.

## Comparison

- Clicking the contract row or eye action now opens an in-context modal over the patient profile.
- The modal surfaces the contract number, status, signature timestamp, validity period, and creation timestamp.
- Status editing remains available for authorized roles and opens the existing editor deliberately.
- The patient route stays unchanged and no additional contracts workspace tab is opened.

## Verification

- Live browser inspection confirmed the modal opens from the table while the URL remains on the patient contracts tab.
- The focused desktop capture shows a centered, compact dialog with readable metadata, balanced spacing, and no clipping or overlap.
- TypeScript project check and targeted ESLint check passed.

final result: passed

---

# Design QA — Lead passport data in the patient profile

## Evidence

- Source visual truth: `C:/Users/oleks/AppData/Local/Temp/codex-clipboard-45ab5aa8-16a0-4763-aebe-e6c978c33cfc.png` (3480 × 942 px).
- Implementation captures: Codex in-app browser captures from the patient profile and the source lead wizard in this task.
- Patient route: `http://127.0.0.1:5173/patients/:patientId`.
- Lead route: `http://127.0.0.1:5173/leads?lead=:leadId&view=wizard`.
- Verified viewport: 1468 × 1272 CSS px.

## Comparison

- The patient Passport card now begins with a `Скан паспорта` row and shows the transferred lead file as a compact orange document link.
- The existing passport number and expiry rows keep their original spacing and typography.
- The lead identity-document card now contains a `Действителен до` date picker beside the existing file-format hint, directly below the upload action.
- Citizenship remains a separate field from country of residence. The lead visibly contains `Украина` in both fields; the patient profile will receive only the dedicated citizenship value.
- Existing card borders, heading markers, input height, calendar affordance, and responsive wizard footer remain aligned with the shared GMED style.

## Verification

- The accessibility tree exposes the passport filename as a button that opens the patient Documents tab.
- The lead wizard exposes the new passport expiry control as a date input with day, month, year, and calendar controls.
- The focused desktop captures show no clipped controls, overlap, layout shift, or actionable P0/P1/P2 visual issue.
- Targeted TypeScript, ESLint, Rust formatting, server compile, migration hygiene, and frontend production build checks passed.

final result: passed

---

# Design QA — Lead wizard medication table

## Evidence

- Source visual truth: `C:/Users/oleks/AppData/Local/Temp/codex-clipboard-b24c281f-7b70-449b-9af4-37bbe215cd9a.png` (2048 × 1335 px).
- Implementation capture: Codex in-app browser capture from `http://127.0.0.1:5173/leads?lead=ad7f4816-b2aa-4476-9715-14457dc2dbf7&view=wizard` at the 2048 × 1335 px reference viewport.
- State: `Медицинская характеристика`, one medication on hold, Russian locale.

## Comparison

- The local medication grid now uses the shared `DataTable` surface used by the rest of GMED: standard header typography, column separators and resizing, row dividers, pinned action column, and horizontal overflow.
- The section header, medication count, and orange `Добавить` action retain the same hierarchy as the source.
- Medication content remains visible in compact rows, including substance, trade name, intake end, strength, form, dose schedule, hold period and note, clinical attribution, indication, and actions.
- Held and ended medications use the shared row accent and background APIs. The pause, edit, and delete controls remain grouped in the pinned action column.
- Mobile output uses the shared responsive medication card layout with the trade name as the primary value and the main clinical fields as details.

## Verification

- The source and implementation were compared in the in-app browser at the same 2048 × 1335 desktop viewport, then rechecked at the default desktop viewport.
- The accessibility tree exposes the section as a table with named columns, resize handles, one row, and all three row actions.
- No browser console errors or warnings were recorded.
- Targeted TypeScript, ESLint, and medication integration tests passed.
- No clipped controls, overlap, layout shift, or actionable P0/P1/P2 visual issue remains.

final result: passed

---

# Design QA — Lead order specialization scrolling

## Evidence

- Source visual truth: `C:/Users/oleks/AppData/Local/Temp/codex-clipboard-0b702d9b-41d6-4b16-bb2d-4ed8d3184f62.png` (2080 × 1071 px).
- Implementation capture: Codex in-app browser capture from `http://127.0.0.1:5173/leads` in this task.
- Verified viewports: 1280 × 720 and the source viewport 2080 × 1071 CSS px.
- State: stage 5, `Оформление заказа`, with several selected specializations and expanded work types.

## Comparison

- The selected-specialization area now has its own visible vertical scrollbar and keeps the surrounding form fields stationary.
- At 2080 × 1071 the region is 416 px high with 867 px of content; it scrolls from the first card to the final work types.
- The wizard footer remains fixed and both `Назад` and `Далее` stay inside the viewport while the specialization list scrolls.
- Existing card borders, spacing, typography, checkboxes, duration chips, price chips, and remove actions remain unchanged.
- The region is keyboard focusable and receives the existing focus-ring token for keyboard navigation.

## Verification

- Live DOM inspection confirmed `overflow-y: scroll` and a positive `scrollTop` after scrolling at both checked viewport sizes.
- At 2080 × 1071 the `Далее` button remained visible at all times.
- Targeted ESLint, TypeScript project check, production Vite build, and `git diff --check` passed.
- No clipped controls, overlap, layout shift, or actionable P0/P1/P2 visual issue remains.

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

---

# Design QA — Order header actions without aggregate signature

## Evidence

- Source visual truth: `C:/Users/oleks/AppData/Local/Temp/codex-clipboard-f53308b8-0bb6-4e3c-af55-93c070db2e64.png`.
- Implementation capture: Codex in-app browser capture from `http://127.0.0.1:5173/orders/:orderId?patient=:patientId`.
- State: active patient order in the overview section.

## Comparison

- The aggregate `Электронная подпись` action was removed from the order header.
- `Пациент`, `Документы`, lifecycle controls, and their original spacing remain intact.
- Signature actions for individual documents remain available in document-specific surfaces.

## Verification

- The live accessibility tree exposes `Пациент`, `Документы`, `Приостановить`, `Завершить`, and `Отменить` in the header, with no aggregate signature button.
- The focused desktop capture shows the action row reflowed without a gap, clipping, overlap, or layout shift.
- Targeted ESLint and TypeScript project checks passed.

final result: passed


---

# Design QA — Sanctions, lead documents, orders and form privacy — 2026-10-12

## Evidence and scope

- Source captures supplied by the user: `codex-clipboard-64c080ba-6012-468e-994c-2fbd4930f9be.png` (payer), `codex-clipboard-015bacdf-b305-4dff-96e5-745a54b8bbaf.png` (patient data), `codex-clipboard-9432708b-0e6b-47c2-a5c3-274de296e9d3.png` (risk table), and `codex-clipboard-862e28fc-a438-4c87-a1f6-d0dcd39b3a4c.png` (order pipeline), read from the user's Temp folder.
- Main implementation at `http://127.0.0.1:5173`. Captures in `C:/Users/oleks/Developer/gmed/.tmp/sanctions-design/`: `before.png`, `after.png`, `list.png`, `risk.png`, `mobile-list-before.png`, `mobile-list.png`, `lead-components.png`, `lead-components-mobile.png`, `order-overview.png`, `order-pipeline-bottom.png`, `legal-before.png`, `legal-after.png`, `legal-retention.png`, `legal-lists.png`.
- Source and revised captures were opened together in comparison inputs. The supplied screenshots describe the areas to restyle; existing console typography and components are the design authority. Smaller typography, compact cards, plain field labels, shared table and separators are intentional changes.
- Payer/patient/risk components were rendered with synthetic data and disabled actions to avoid remote autosave. Representation fields and invoice tax inputs were included. Orders and legal notice were inspected through read-only live routes. Medical form actions and document generation were not exercised.
- The legal before capture enters at `#privacy`; the after capture also verifies the newly styled page header at `/legal`. This is an intentional difference in scroll position, not a visual fidelity claim for identical crops.

## Findings and iterations

1. P2 — the selected sanctions tab was clipped at 390 px. Added active-tab reveal on selection and nav resize. The post-fix mobile capture shows the entire active label inside the viewport; page width remains 390 px.
2. P2 — oversized/uppercase labels, deep nested cards and wide gaps in the supplied lead/order captures. Reused console section titles, light borders, 13 px body text, 11.5 px labels, compact grids and inline metrics. Revised desktop and mobile component captures have no clipped text or controls.
3. P2 — the hand-built risk table did not use the shared table and the date column lacked separation. Replaced it with DataTable, explicit column widths, wrapping and tabular dates. The desktop row is readable; the 390 px breakpoint uses the table's existing record cards with all four detail fields. Document width 380 px equals scroll width 380 px (10 px scrollbar).
4. P2 — privacy lists became plain paragraphs during initial text extraction. Re-extracted the reference's OOXML list markers. Revised DOM has 14 numbered sections, five semantic lists and 22 list items in DE and RU: six data categories, five purposes, two processors, four other recipients, five retention cases. The retention capture shows bullets and consistent continuation spacing.

## Fidelity surfaces

- Typography: existing application font stack retained; normal-case compact labels, semibold section headings and monospace dates/numbers. Long Russian/German labels wrap. Reduced display size is intentional for console density.
- Spacing/layout: compact padding, aligned grid columns and dividers replace nested grey cards. Mobile patient facts become one column; table records wrap. No horizontal page overflow in the tested component state.
- Colors/tokens: existing card/field/border/foreground tokens and GMED orange marker; blue patient provenance, amber warnings and red mandatory compliance remain semantic. Disabled fixture controls intentionally look disabled.
- Assets: existing GMED logo raster reused for the public legal header; existing Lucide icons retained. No custom logo/icon approximations or generated images.
- Copy/content: requested helper labels removed; document readiness/action warnings highlighted. The supplied privacy text keeps its DE/RU content and list structure, uses configured agency contacts, omits the reference's unresolved website-policy placeholder, and renders the responsible person's configured name with a localized label. Existing cooperation notice remains for contracted patients.

## Verification and limits

- Main and worktree TypeScript checks and focused ESLint checks passed for the completed code, including the final privacy list and layout changes.
- Targeted tests cover sanctions country union/failure behavior, payer data, patient statements, risk triggers, order need/pipeline models, privacy scope and list semantics, cabinet languages and Cyrillic-only name hints.
- Name hint is advisory, shown only for actual Cyrillic in first/last/middle name, and preserves entered values and field error descriptions. Latin accented names and empty names have no hint.
- Country sync is triggered after a manual sanctions refresh/import, unions current geographic regimes with existing country blocks, and preserves policy on source failure. No remote policy write was performed for visual QA; the existing daily backend scheduler is outside this frontend change.
- The 4176 worktree contains the same scoped changes while preserving its newer behavior. Its signed-in visual QA remains unavailable because the existing login was reported deactivated; no account settings were changed. Main 5173 provides rendered verification.
- DOCX reference text and list markers were inspected locally. Its packaged renderer could not run because LibreOffice is absent; no edited DOCX is being delivered.
- Clean final load of `/legal`: 14 sections, five lists, 22 items, no page overflow (1280/1280 px) and no new console errors. An earlier HMR error during the temporary content-schema transition was cleared by loading the final modules.

No actionable P0/P1/P2 issue remains in the rendered main preview states. The remaining 4176 authentication limit is an environment constraint.

final result: passed (main preview); worktree authenticated visual verification blocked by deactivated login


---

# Design QA — Wizard follow-up and cabinet evidence — 2026-10-12

## Final behavior

- The wizard uses a grey canvas with white sections, compact console typography and shared semantic StatusChip tokens. Missing/blocked items use amber; completed consents and checks use green. The fill-mode selection uses solid GMED orange and keyboard navigation. Portal completion and document counts are separate colored chips.
- Payer-link language, contact consent, send eligibility and recipient statements use the same section/field/chip styles. The economic-interest Yes/No controls and unanswered chip sit immediately beside the question and wrap on narrow screens.
- Diagnosis, anamnesis, allergy, CAVE and medication editors share centered Dialog layout, grey scroll canvas, white groups and fixed footer. Their backdrop and the outer lead wizard cover the full viewport with black at 40% opacity.
- The passport spelling hint is permanently visible in RU/UA; separate field correction appears for Cyrillic. This supersedes the earlier conditional-only hint. The release worktree also includes the confirmed optional transliteration suggestion and user-friendly copy; entered values are preserved until the user accepts a suggestion.
- The eight cabinet visibility gaps are mapped in [cabinet-to-wizard-parity.md](qa/cabinet-to-wizard-parity.md), with explicit unknown/declined semantics and existing medical/identity permissions. A source count of 113 independently exercised fields is not claimed because the original matrix was unavailable.

## Rendered checks

- Actual components were rendered in an ignored preview using synthetic names, organisation/contact data, statement choices and file metadata. Clinical and payer callbacks were local mocks; no invitation, patient consent, signature, real clinical save or remote policy update was submitted.
- Desktop captures: `C:/Users/oleks/Developer/gmed/.tmp/sanctions-design/payer-section-after.png`, `payer-link-after.png`, `wizard-consents-after.png`, `anamnesis-checklist-after.png`, and the five `*-editor-after.png` captures. Supplied diagnosis/anamnesis screenshots were inspected alongside implementation captures.
- Mobile diagnosis, anamnesis, allergy and medication dialogs at 390 × 844: content width 364 px, height 812 px, no horizontal dialog overflow; header and footer remain reachable. The medication picker closes with Escape while keeping its editor open. Anamnesis still prompts before discarding an edited checklist.
- The live outer wizard backdrop was measured against the full browser viewport (1546 × 1244). Browser viewport overrides were reset after responsive checks.

## Release checks at preparation

- Canonical release source: latest upstream main plus the agreed product changes, including removal of new cryptocurrency payment choices and closure of a minor's own cabinet login before parents receive access.
- Full frontend suite: 364 test files, 3225 tests passed. Full frontend lint, staff navigation guard, TypeScript and production Vite build passed. Targeted consent, payer, clinical dialog and keyboard tests passed in both checkouts.
- Server read-only consent helper tests and patient form PDF payment-route test passed from a separate canonical-worktree target directory; Rust formatter and relevant Clippy check passed. The isolated lead cabinet API suite and final payer autosave checks are recorded separately after completion.
- This section documents local rendering and checks; DEV publication/live payload verification is recorded in the release verification entry. It does not certify a live cabinet-to-wizard round trip for every draft slot.

final result: rendered follow-up passed; full DEV publication verification pending


## Follow-up verification and deployment timing

- Latest completed frontend state: 365 test files / 3235 tests passed; main and canonical TypeScript checks passed. Full lint and staff navigation checks passed; the canonical production Vite build passed after the autosave type correction. The focused payer suites have 78 checks, including 9 autosave regressions for serialized updates, retry and flush on step/unmount; rendered synthetic Yes/No input changed the local save counter once and showed the green saved chip without a Save button.
- DEV deployment runner recovery tests were actually executed in a Linux container: 17 passed. Release image/migration-rehearsal coverage: 8 passed. The first Windows runner invocation skipped the Linux-only cases; that is superseded by the executed Linux run.
- The isolated cabinet API run exposed a clock-source mismatch: application-time markers could appear older than database-time submission. Canonical portal marker writers now use database clock_timestamp() after the row lock; submission and declaration confirmation share a database timestamp. The insurance-after-submit regression passed with an explicit marker-after-submission assertion and the original changed-since-submit/re-send assertions.
- Minor notification inserts now serialize on the lead and recheck once-only state inside the same transaction. A deterministic test with two concurrent readers and a real PostgreSQL lock gate passed with a four-connection pool. Existing guardian choice checks additionally assert the staff consent_form values and author metadata.
- The owner is still editing the canonical source and explicitly said they will announce readiness. No DEV publish, release commit or final source freeze has occurred. Repeat full release gates and refresh the isolated candidate from the completed canonical source after that signal; the candidate currently is preparation only.

final result: completed scoped changes verified; full DEV release awaits the owner's finished edits
