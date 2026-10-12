/**
 * Server error codes of internal notes on quotes/invoices and of re-billing
 * waivers (supplier costs GMED absorbs), mapped to translated texts (`uiText`
 * keys in `lib/i18n/catalogs/billing-ui.ts`). `apiFetch` shows the
 * translation instead of the English server message (owner 2026-10-12).
 */
export const BILLING_API_ERROR_KEYS: Record<string, string> = {
  // crates/server/src/routes/invoices.rs (quotes and invoices)
  internal_note_too_long: "api_billing_internal_note_too_long",
  // crates/server/src/routes/invoices/rebilling_waivers.rs
  rebilling_waiver_reason_required: "api_billing_rebilling_waiver_reason_required",
  rebilling_waiver_nothing_to_waive: "api_billing_rebilling_waiver_nothing_to_waive",
  rebilling_waiver_not_possible: "api_billing_rebilling_waiver_not_possible",
  rebilling_waiver_already_reversed: "api_billing_rebilling_waiver_already_reversed",
};
