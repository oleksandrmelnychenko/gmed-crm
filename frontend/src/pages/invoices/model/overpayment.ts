import { roundCents, toCents } from "@/lib/money";

/**
 * Overpayments and credit transfers. A receipt above the open balance is
 * recorded in full; the excess becomes the patient's credit balance on the
 * invoice, which billing refunds or moves to another open invoice.
 */

/** A credit balance moved between two invoices of the patient. */
export type InvoiceCreditTransfer = {
  id: string;
  direction: "in" | "out";
  source_invoice_id: string;
  source_invoice_number: string;
  target_invoice_id: string;
  target_invoice_number: string;
  amount_gross: string;
  currency: string;
  transferred_on: string;
  note: string | null;
  created_by_name: string;
  created_at: string;
  is_reversed: boolean;
};

/** Open invoice of the same patient a credit balance can settle. */
export type InvoiceCreditTransferTarget = {
  invoice_id: string;
  invoice_number: string;
  invoice_type: string;
  order_number: string | null;
  balance_due: string;
};

/** Receipts moved from another invoice's credit, not money from outside. */
export const CREDIT_TRANSFER_METHOD = "credit_transfer";

function amount(value: unknown): number {
  const text = String(value ?? "").trim();
  if (text === "") return Number.NaN;
  const numeric = Number(text.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}

/** Part of a receipt above the open balance (0 when it fits). */
export function paymentOverpayment(receipt: unknown, balanceDue: unknown): number {
  const paid = amount(receipt);
  const open = amount(balanceDue);
  if (!Number.isFinite(paid) || paid <= 0) return 0;
  const excess = roundCents(paid - (Number.isFinite(open) ? Math.max(open, 0) : 0));
  return toCents(excess) > 0 ? excess : 0;
}

/** Proposed transfer: the credit, at most what the target still asks for. */
export function creditTransferDefaultAmount(credit: unknown, targetBalance: unknown): string {
  const available = Math.min(amount(credit), amount(targetBalance));
  return Number.isFinite(available) && available > 0 ? roundCents(available).toFixed(2) : "";
}

export type CreditTransferProblem = "invalid_amount" | "exceeds_credit" | "exceeds_target" | "no_target";

export function creditTransferProblem(
  transfer: unknown,
  credit: unknown,
  targetBalance: unknown,
): CreditTransferProblem | null {
  if (!Number.isFinite(amount(targetBalance))) return "no_target";
  const value = amount(transfer);
  if (!Number.isFinite(value) || toCents(value) <= 0) return "invalid_amount";
  if (toCents(value) > toCents(amount(credit))) return "exceeds_credit";
  if (toCents(value) > toCents(amount(targetBalance))) return "exceeds_target";
  return null;
}
