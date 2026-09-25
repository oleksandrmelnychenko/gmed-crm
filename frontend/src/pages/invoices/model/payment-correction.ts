import { toCents } from "@/lib/money";
import type { InvoicePaymentTransaction } from "./types";

/** Methods the API accepts for new receipts; `legacy_import` is import-only. */
export const INVOICE_PAYMENT_METHODS = [
  "bank_transfer",
  "card",
  "cash",
  "direct_debit",
  "cheque",
  "other",
] as const;

export type PaymentCorrectionForm = {
  requestId: string;
  amountGross: string;
  paymentMethod: string;
  paymentReference: string;
  receivedOn: string;
  note: string;
  reason: string;
};

export type PaymentCorrectionProblem =
  | "invalid_amount"
  | "exceeds_balance"
  | "missing_date"
  | "missing_reason"
  | "unchanged";

/** A payment can be edited while it is a live, API-recorded receipt on an active invoice. */
export function canCorrectPayment(
  payment: Pick<InvoicePaymentTransaction, "transaction_type" | "is_reversed" | "payment_method">,
  invoiceStatus: string,
): boolean {
  return (
    payment.transaction_type === "payment" &&
    !payment.is_reversed &&
    payment.payment_method !== "legacy_import" &&
    invoiceStatus !== "draft" &&
    invoiceStatus !== "cancelled"
  );
}

export function paymentCorrectionProblem(
  form: PaymentCorrectionForm,
  payment: Pick<
    InvoicePaymentTransaction,
    "amount_gross" | "payment_method" | "payment_reference" | "received_on" | "note"
  >,
  maxAmount: number,
): PaymentCorrectionProblem | null {
  const amount = Number(form.amountGross);
  if (!Number.isFinite(amount) || amount <= 0) return "invalid_amount";
  if (toCents(amount) > toCents(maxAmount)) return "exceeds_balance";
  if (!form.receivedOn) return "missing_date";
  const unchanged =
    toCents(amount) === toCents(Number(payment.amount_gross)) &&
    form.paymentMethod === payment.payment_method &&
    form.paymentReference.trim() === (payment.payment_reference ?? "").trim() &&
    form.receivedOn === payment.received_on &&
    form.note.trim() === (payment.note ?? "").trim();
  if (unchanged) return "unchanged";
  if (!form.reason.trim()) return "missing_reason";
  return null;
}

export function buildPaymentCorrectionPayload(form: PaymentCorrectionForm) {
  return {
    request_id: form.requestId,
    amount_gross: Number(form.amountGross),
    payment_method: form.paymentMethod,
    payment_reference: form.paymentReference.trim() || null,
    received_on: form.receivedOn,
    note: form.note.trim() || null,
    reason: form.reason.trim(),
  };
}
