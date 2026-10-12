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
  // Every issued document names GMED's tax registration (release.rs, QA
  // D2-09): also a service cancelled from the order that issues a credit note.
  issuer_tax_registration_missing: "api_billing_issuer_tax_registration_missing",
  // advance_settlement.rs
  advance_rest_already_closed: "api_billing_advance_rest_already_closed",
  advance_not_settled_by_final_invoice: "api_billing_advance_not_settled_by_final_invoice",
};
