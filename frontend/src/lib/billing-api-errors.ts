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
  rebilling_waiver_settlement_closed: "api_billing_rebilling_waiver_settlement_closed",
  credit_note_rebilled: "api_billing_credit_note_rebilled",
  // Every issued document names GMED's tax registration (release.rs, QA
  // D2-09): also a service cancelled from the order that issues a credit note.
  issuer_tax_registration_missing: "api_billing_issuer_tax_registration_missing",
  // A draft cannot be released while it bills a cancelled service (release.rs).
  invoice_bills_cancelled_service: "api_billing_invoice_bills_cancelled_service",
  // An invoice bills the actual quantities (doc 2.4, QA 2026-10-31).
  invoice_bills_above_actual_services: "api_billing_invoice_bills_above_actual_services",
  quote_behind_actual_services: "api_billing_quote_behind_actual_services",
  // A draft advance is not released beside a final invoice (QA 2026-11-01).
  advance_beside_final_invoice: "api_billing_advance_beside_final_invoice",
  // An advance takes only what the quote has left to bill (QA 2026-11-01, Y2 B1).
  advance_over_billed_quote: "api_billing_advance_over_billed_quote",
  // An interim invoice leaves what an unpaid advance asks for (QA 2026-11-01, Z1 N1).
  interim_over_open_advance: "api_billing_interim_over_open_advance",
  // Concierge services billed at their sale price (invoices/concierge_lines.rs, F-C8).
  concierge_service_not_ready: "api_billing_concierge_service_not_ready",
  concierge_service_without_price: "api_billing_concierge_service_without_price",
  concierge_service_already_invoiced: "api_billing_concierge_service_already_invoiced",
  concierge_service_other_order: "api_billing_concierge_service_other_order",
  concierge_service_other_currency: "api_billing_concierge_service_other_currency",
  concierge_service_no_tax_profile: "api_billing_concierge_service_no_tax_profile",
  invoice_bills_changed_concierge_service: "api_billing_invoice_bills_changed_concierge_service",
  // advance_settlement.rs
  advance_rest_already_closed: "api_billing_advance_rest_already_closed",
  advance_not_settled_by_final_invoice: "api_billing_advance_not_settled_by_final_invoice",
};
