/**
 * Server error codes of orders, framework contracts, quotes and the service
 * catalogues, mapped to translated texts (`uiText` keys in
 * `lib/i18n/catalogs/orders-ui.ts`). `apiFetch` shows the translation instead
 * of the English server message (QA 2026-10-11). Placeholders such as
 * `{order_total_label}` are filled from the fields of the error body.
 */
export const ORDER_API_ERROR_KEYS: Record<string, string> = {
  // Orders (crates/server/src/routes/orders.rs)
  prepayment_amount_required: "api_orders_prepayment_amount_required",
  prepayment_amount_invalid: "api_orders_prepayment_amount_invalid",
  prepayment_exceeds_order_total: "api_orders_prepayment_exceeds_order_total",
  order_period_invalid: "api_orders_period_invalid",
  order_closed_for_new_services: "api_orders_closed_for_new_services",
  agency_service_currency_mismatch: "api_orders_agency_service_currency_mismatch",
  agency_service_price_version_mismatch: "api_orders_agency_service_price_version_mismatch",
  agency_service_no_active_price: "api_orders_agency_service_no_active_price",
  // Framework contracts, quotes and the agency catalogue (contracts.rs)
  quote_valid_until_past: "api_quotes_valid_until_past",
  prepayment_exceeds_quote_total: "api_quotes_prepayment_exceeds_total",
  quote_superseded: "api_quotes_superseded",
  quote_outdated: "api_quotes_outdated",
  quote_without_services: "api_quotes_without_services",
  framework_contract_terminated_locked: "api_contracts_terminated_locked",
  framework_contract_use_terminate: "api_contracts_use_terminate",
  framework_contract_cannot_start_terminated: "api_contracts_cannot_start_terminated",
  framework_contract_not_terminable: "api_contracts_not_terminable",
  framework_contract_signature_evidence_required: "api_contracts_signature_evidence_required",
  termination_reason_length: "api_contracts_termination_reason_length",
  agency_service_key_taken: "api_catalog_agency_service_key_taken",
  price_version_date_taken: "api_catalog_price_version_date_taken",
  price_version_last: "api_catalog_price_version_last",
  // A generated consent or contract is signed only with a signed scan or a QES.
  signature_evidence_required: "api_documents_signature_evidence_required",
  // Provider service catalogue (providers.rs)
  provider_service_price_range_invalid: "api_providers_service_price_range_invalid",
  provider_service_price_from_required: "api_providers_service_price_from_required",
  provider_service_name_required: "api_providers_service_name_required",
  provider_service_validity_invalid: "api_providers_service_validity_invalid",
};
