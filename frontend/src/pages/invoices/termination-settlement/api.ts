import { apiFetch } from "@/lib/api";

/** Money values arrive as decimal strings (e.g. "749.7"). */
export type DecimalString = string;

export type TerminationSettlementLine = {
  source: "order_service" | "third_party_cost";
  order_leistung_id: string | null;
  external_invoice_id: string | null;
  description: string;
  quantity: DecimalString;
  unit_price: DecimalString;
  vat_rate: DecimalString;
  net: DecimalString;
  vat: DecimalString;
  gross: DecimalString;
  status: string;
  due_in_full: boolean;
  is_cost_passthrough: boolean;
};

/**
 * Settlement figures on the account-statement basis:
 * `balance = invoiced + uninvoiced - paid`. `uninvoiced` is what accrued but
 * is not on a released invoice (uninvoiced services, third-party costs still
 * to re-invoice, drafts); `billable` is what "create final invoice" bills now.
 */
export type TerminationFigures = {
  accrued_net: DecimalString;
  accrued_gross: DecimalString;
  invoiced_gross: DecimalString;
  paid_gross: DecimalString;
  balance_gross: DecimalString;
  uninvoiced_gross: DecimalString;
  /** Live figures only; snapshots taken at termination do not carry them. */
  draft_gross?: DecimalString;
  billable_gross?: DecimalString;
  unmatched_invoiced_gross?: DecimalString;
  /** Invoiced in advance, never delivered, not credited yet: owed back. */
  to_credit_gross?: DecimalString;
};

export type TerminationPreviewOrder = TerminationFigures & {
  id: string;
  order_number: string;
  status: string;
  currency: string;
  lines: TerminationSettlementLine[];
  cancelled_lines: TerminationSettlementLine[];
  warnings: string[];
};

export type TerminationPreview = {
  contract_id: string;
  open_orders: TerminationPreviewOrder[];
};

export type TerminationResultSettlement = {
  order_id: string;
  order_number: string;
  settlement_id: string | null;
  settlement_status: "open" | "settled" | null;
  accrued_gross: DecimalString;
  invoiced_gross: DecimalString;
  paid_gross: DecimalString;
  balance_gross: DecimalString;
  uninvoiced_gross: DecimalString;
  cancelled_services: number;
  flat_fees_due: number;
};

export type TerminationSettlementStatus = "open" | "settled";

export type TerminationSettlement = {
  id: string;
  order_id: string;
  order_number: string;
  order_status: string;
  patient_id: string;
  patient_pid: string | null;
  patient_name: string;
  contract_id: string;
  contract_number: string;
  terminated_at: string;
  currency: string;
  status: TerminationSettlementStatus;
  snapshot: TerminationFigures;
  current: TerminationFigures & { warnings: string[] };
  can_settle: boolean;
  lines: TerminationSettlementLine[];
  final_invoice: {
    id: string;
    /** Assigned when the draft is released. */
    invoice_number: string | null;
    status: string;
    total_gross: DecimalString;
  } | null;
  settled_at: string | null;
  settled_by_name: string | null;
  settlement_note: string | null;
  settlement_forced: boolean;
  settled_balance_gross: DecimalString | null;
  created_at: string;
  created_by_name: string | null;
};

export type TerminationSettlementFilter = TerminationSettlementStatus | "all";

export type FinalInvoiceResult = {
  id: string;
  /** Drafts carry no number until they are released. */
  invoice_number: string | null;
  termination_settlement_id: string;
  idempotent_replay: boolean;
};

export function fetchTerminationPreview(contractId: string) {
  return apiFetch<TerminationPreview>(
    `/framework-contracts/${encodeURIComponent(contractId)}/termination-preview`,
    { forceFresh: true },
  );
}

export function fetchOrderTerminationSettlement(orderId: string) {
  return apiFetch<TerminationSettlement>(
    `/orders/${encodeURIComponent(orderId)}/termination-settlement`,
    { forceFresh: true },
  );
}

export function fetchPatientTerminationSettlements(patientId: string) {
  return apiFetch<TerminationSettlement[]>(
    `/patients/${encodeURIComponent(patientId)}/termination-settlements`,
    { forceFresh: true },
  );
}

export function fetchTerminationSettlementQueue(status: TerminationSettlementFilter) {
  return apiFetch<TerminationSettlement[]>(
    `/invoices/termination-settlements?status=${encodeURIComponent(status)}`,
    { forceFresh: true },
  );
}

export function createTerminationFinalInvoice(orderId: string) {
  return apiFetch<FinalInvoiceResult>(
    `/orders/${encodeURIComponent(orderId)}/termination-settlement/final-invoice`,
    { method: "POST" },
  );
}

export function settleTermination(orderId: string, payload: { note?: string; force?: boolean }) {
  return apiFetch<TerminationSettlement>(
    `/orders/${encodeURIComponent(orderId)}/termination-settlement/settle`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}
