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

export type CashMovementOperation = {
  label: string;
  reference: string | null;
};

const cashOperationLabels = {
  ru: {
    invoicePayment: "Оплата счета",
    invoicePaymentReversal: "Отмена оплаты счета",
    invoiceRefund: "Возврат по счету",
    invoiceRefundReversal: "Отмена возврата по счету",
    providerPayment: "Оплата поставщику",
    providerPaymentReversal: "Отмена оплаты поставщику",
    conciergePayment: "Оплата партнеру Concierge",
    conciergePaymentReversal: "Отмена оплаты партнеру Concierge",
    externalInvoicePayment: "Оплата счета поставщика",
  },
  de: {
    invoicePayment: "Rechnungszahlung",
    invoicePaymentReversal: "Storno der Rechnungszahlung",
    invoiceRefund: "Rückerstattung zur Rechnung",
    invoiceRefundReversal: "Storno der Rückerstattung",
    providerPayment: "Zahlung an Lieferanten",
    providerPaymentReversal: "Storno der Lieferantenzahlung",
    conciergePayment: "Zahlung an Concierge-Partner",
    conciergePaymentReversal: "Storno der Concierge-Partnerzahlung",
    externalInvoicePayment: "Zahlung der Lieferantenrechnung",
  },
} as const;

type CashOperationKey = keyof (typeof cashOperationLabels)["ru"];

const cashOperationPatterns: ReadonlyArray<[RegExp, CashOperationKey]> = [
  [/^invoice_payment payment\s*(.*)$/i, "invoicePayment"],
  [/^invoice_payment reversal\s*(.*)$/i, "invoicePaymentReversal"],
  [/^invoice_refund refund\s*(.*)$/i, "invoiceRefund"],
  [/^invoice_refund reversal\s*(.*)$/i, "invoiceRefundReversal"],
  [/^Provider payment reversal\s*(.*)$/i, "providerPaymentReversal"],
  [/^Provider payment\s*(.*)$/i, "providerPayment"],
  [/^Concierge partner payment reversal\s*(.*)$/i, "conciergePaymentReversal"],
  [/^Concierge partner payment\s*(.*)$/i, "conciergePayment"],
  [/^External invoice payment\s*(.*)$/i, "externalInvoicePayment"],
];

/** Turns the technical accounting-entry description into a readable operation label. */
export function describeCashMovement(description: string, lang: "ru" | "de"): CashMovementOperation {
  const trimmed = description.trim();
  for (const [pattern, key] of cashOperationPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const reference = match[1]?.trim() ?? "";
      return { label: cashOperationLabels[lang][key], reference: reference || null };
    }
  }
  return { label: trimmed || "—", reference: null };
}
