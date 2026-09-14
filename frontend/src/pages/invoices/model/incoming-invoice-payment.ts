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

export function canMarkInvoicePaidByPatient(invoice: PatientPaymentInvoice) {
  return invoice.invoice_scope === "patient_order" && Boolean(invoice.patient_id);
}

export function patientPaymentErrorReason(error: unknown): PatientPaymentErrorReason | null {
  if (!(error instanceof ApiRequestError)) return null;
  return ERROR_REASONS.get(error.message.trim()) ?? null;
}
