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
  | "missing_date"
  | "missing_reason"
  | "unchanged";

/**
 * A payment can be edited while it is a live, API-recorded receipt on an
 * active invoice. A credit transfer is undone by reversing the transfer.
 */
export function canCorrectPayment(
  payment: Pick<InvoicePaymentTransaction, "transaction_type" | "is_reversed" | "payment_method">,
  invoiceStatus: string,
): boolean {
  return (
    payment.transaction_type === "payment" &&
    !payment.is_reversed &&
    payment.payment_method !== "legacy_import" &&
    payment.payment_method !== "credit_transfer" &&
    invoiceStatus !== "draft" &&
    invoiceStatus !== "cancelled"
  );
}

/**
 * Part of the corrected receipt above what the invoice asks for (`maxAmount`
 * = open balance plus this payment); recorded as the patient's credit.
 */
export function paymentCorrectionOverpayment(form: PaymentCorrectionForm, maxAmount: number): number {
  const amount = Number(form.amountGross);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const excess = toCents(amount) - toCents(Math.max(maxAmount, 0));
  return excess > 0 ? excess / 100 : 0;
}

export function paymentCorrectionProblem(
  form: PaymentCorrectionForm,
  payment: Pick<
    InvoicePaymentTransaction,
    "amount_gross" | "payment_method" | "payment_reference" | "received_on" | "note"
  >,
): PaymentCorrectionProblem | null {
  const amount = Number(form.amountGross);
  if (!Number.isFinite(amount) || amount <= 0) return "invalid_amount";
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

export function buildPaymentCorrectionPayload(form: PaymentCorrectionForm, maxAmount = Infinity) {
  return {
    request_id: form.requestId,
    amount_gross: Number(form.amountGross),
    payment_method: form.paymentMethod,
    payment_reference: form.paymentReference.trim() || null,
    received_on: form.receivedOn,
    note: form.note.trim() || null,
    reason: form.reason.trim(),
    // The form shows the excess before saving; saving confirms it.
    accept_overpayment: paymentCorrectionOverpayment(form, maxAmount) > 0,
  };
}
