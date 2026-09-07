import type { CompanyBalanceSide, CompanyPatientPosition, CompanyProviderLiability, CompanyProviderPosition } from "./types";

export type PatientSideFilter = "all" | CompanyBalanceSide | "reconciliation";
export type ProviderSettlementFilter = "open" | "partial" | "settled" | "expected" | "all";
type ProviderIdentity = Pick<CompanyProviderPosition, "provider_id" | "provider_name">;
const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export function providerGroupKey(row: ProviderIdentity) {
  const name = normalize(row.provider_name ?? "");
  return row.provider_id ?? (name ? `supplier:${name}` : "__unassigned__");
}

export function providerDisplayName(row: ProviderIdentity, fallback: string) {
  return row.provider_name?.trim() || fallback;
}

function matchesSearch(search: string, ...values: (string | null | undefined)[]) {
  return normalize(values.filter(Boolean).join(" ")).includes(normalize(search));
}

export function filterPatientPositions(rows: readonly CompanyPatientPosition[], side: PatientSideFilter, search: string) {
  return rows.filter(row => matchesSearch(search, row.patient_name, row.patient_pid)
    && (side === "all" || (side === "reconciliation" ? row.reconciliation_required : row.balance_side === side)));
}

function matchesProviderStatus(row: CompanyProviderLiability, status: ProviderSettlementFilter) {
  if (status === "all") return true;
  if (status === "partial") return row.settlement_status === "partial";
  return row.liability_kind === (status === "open" ? "payable" : status);
}

export function filterProviderDocuments(rows: readonly CompanyProviderLiability[], status: ProviderSettlementFilter, selectedGroup: string | null, search = "") {
  return rows.filter(row => (selectedGroup === null || providerGroupKey(row) === selectedGroup)
    && matchesProviderStatus(row, status)
    && matchesSearch(search, row.provider_name, row.external_invoice_number, row.patient_name, row.patient_pid, row.order_number));
}

export function filterProviderPositions(rows: readonly CompanyProviderPosition[], documents: readonly CompanyProviderLiability[], status: ProviderSettlementFilter, selectedGroup: string | null, search: string) {
  const matchingGroups = new Set(filterProviderDocuments(documents, status, selectedGroup, search).map(providerGroupKey));
  return rows.filter(row => {
    if (selectedGroup !== null && providerGroupKey(row) !== selectedGroup) return false;
    if (status === "open" && Number(row.payable_remaining_gross) <= 0) return false;
    if (status === "expected" && Number(row.expected_remaining_gross) <= 0) return false;
    if (status === "partial" && row.partial_invoice_count <= 0) return false;
    // A supplier may have paid and unpaid invoices at the same time.
    if (status === "settled" && row.settled_invoice_count <= 0) return false;
    return matchesSearch(search, row.provider_name) || matchingGroups.has(providerGroupKey(row));
  });
}
