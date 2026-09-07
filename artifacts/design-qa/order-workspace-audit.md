# Order workspace review — 2026-09-07

Reviewed the overview, readiness, preparation, execution, follow-up, workflow tasks, services and incoming invoices.

## Changes

- Rebuilt the header and overview financial cards so actions do not squeeze the patient name and amounts stay readable. Checked Russian and German at 1440 px and 390 px.
- Added mobile subsection navigation and preserved the specialty filter in navigation links. Readiness now exposes lifecycle history.
- Prevented background refreshes from erasing edited readiness, planning, execution and follow-up fields. Failed refreshes keep the current form usable. Saved notes become clean after server whitespace normalization.
- Made phase transitions show their errors in the active view and disable conflicting actions while saving. Opening debt management preserves other readiness drafts.
- Required an explicit service price and invoice gross amount; associated invoice/service labels with their inputs. Workflow creation and invoice linking show failures where the user is working.
- Fixed amount amendments: decimal commas, zero validation, visible load failures with retry, mobile field width and immediate order total refresh after approval.
- Validated invoice allocations against the remaining receivable and invoice capacity; accepted decimal commas and preserved the idempotency key when retrying a failed allocation.

## Verification

- 23 Playwright scenarios passed: the complete 22-case workspace suite, then the additional allocation scenario covering capacity, comma input, failure and retry.
- 26 order unit tests passed.
- TypeScript, targeted ESLint, staff navigation guard and `git diff --check` passed.
- Frontend production build passed. Vite reports large existing application chunks and Babel plugin timing warnings.
- Screenshots: `order-overview-{ru,de}-{1440,390}.png` and `order-overview-bottom-{ru,de}-{1440,390}.png` in this directory.

Browser checks use synthetic data and intercepted API responses. They verify client behavior and request payloads, not database transactions or live external payment/signature services. No backend code changed in this review.
