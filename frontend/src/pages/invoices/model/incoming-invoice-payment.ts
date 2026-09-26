import { ApiRequestError } from "@/lib/api";

type PatientPaymentInvoice = {
  invoice_scope: string;
  patient_id: string | null;
};

export type PatientPaymentErrorReason =
  | "cancelled"
  | "company_invoice"
  | "company_payment_exists"
  | "invalid_date"
  | "invoice_changed"
  | "not_approved"
  | "not_patient_paid";

const ERROR_REASONS = new Map<string, PatientPaymentErrorReason>([
  ["Cancelled invoice payment state cannot be changed", "cancelled"],
  ["Company invoices cannot be paid by a patient", "company_invoice"],
  ["Reverse company payments before changing the payer", "company_payment_exists"],
  ["Patient payment date must be a valid date not later than today", "invalid_date"],
  ["Payment state changed; reload the invoice and try again", "invoice_changed"],
  ["Only approved unpaid invoices can be marked as paid by the patient", "not_approved"],
  ["Only patient-paid invoices can be reopened", "not_patient_paid"],
]);

type PatientBillingInvoice = PatientPaymentInvoice & {
  status: string;
  paid_by: string;
  remaining_gross: string;
  patient_receivable_gross: string;
  allocated_receivable_gross: string;
  remaining_receivable_gross: string;
};

export type PatientBillingState =
  | "not_required"
  | "billed"
  | "partially_billed"
  | "not_billed"
  | "after_payment";

/**
 * Where a supplier invoice stands in billing the patient. A patient cost that
 * GMed has not paid yet (and that is not delivered) has no receivable yet: it
 * becomes billable after payment, it is not "not required".
 */
export function patientBillingState(invoice: PatientBillingInvoice): PatientBillingState {
  if (
    !invoice.patient_id ||
    invoice.invoice_scope === "company" ||
    invoice.paid_by === "patient" ||
    invoice.status === "cancelled"
  ) {
    return "not_required";
  }
  const receivable = Number(invoice.patient_receivable_gross);
  if (receivable <= 0) return "after_payment";
  if (Number(invoice.remaining_receivable_gross) <= 0) return "billed";
  if (Number(invoice.allocated_receivable_gross) > 0) return "partially_billed";
  if (invoice.paid_by === "agency" && Number(invoice.remaining_gross) <= 0) return "not_billed";
  return "after_payment";
}

export function canMarkInvoicePaidByPatient(invoice: PatientPaymentInvoice) {
  return invoice.invoice_scope === "patient_order" && Boolean(invoice.patient_id);
}

export function patientPaymentErrorReason(error: unknown): PatientPaymentErrorReason | null {
  if (!(error instanceof ApiRequestError)) return null;
  return ERROR_REASONS.get(error.message.trim()) ?? null;
}
