import { apiFetch } from "@/lib/api";
import type { InvoiceImportFields, InvoiceImportPreview, InvoiceImportScope } from "../model/import-model";
import { importMoneyCents } from "../model/import-model";

export function parseInvoiceFile(file: File, signal: AbortSignal) {
  return apiFetch<InvoiceImportPreview>("/invoices/import-preview", {
    method: "POST", headers: { "Content-Type": file.type }, body: file,
    signal, timeoutMs: 225_000,
  });
}

export function uploadInvoiceSource(
  file: File,
  scope: InvoiceImportScope,
  patientId: string,
  orderId: string,
  fields: InvoiceImportFields,
) {
  const body = new FormData();
  body.set("file", file);
  body.set("invoice_scope", scope);
  if (scope === "patient_order") {
    body.set("patient_id", patientId);
    body.set("order_id", orderId);
  }
  body.set("auto_name", fields.external_invoice_number.trim());
  body.set("source_institution", fields.supplier_name.trim());
  if (fields.invoice_date) body.set("document_date", fields.invoice_date);
  if (fields.due_date) body.set("payment_due_date", fields.due_date);
  return apiFetch<{ id: string }>("/invoices/import-document", { method: "POST", body, timeoutMs: 120_000 });
}

export function discardInvoiceImportSource(documentId: string) {
  return apiFetch<{ ok: boolean }>(`/documents/${documentId}/delete`, {
    method: "POST",
    body: JSON.stringify({ reason: "Replaced before invoice import completion" }),
  });
}

export function confirmCompanyInvoiceImport(
  documentId: string,
  fields: InvoiceImportFields,
  notes: string,
) {
  return apiFetch<{ id: string }>("/external-invoices/company", {
    method: "POST",
    body: JSON.stringify({
      source_document_id: documentId,
      supplier_name: fields.supplier_name.trim(),
      external_invoice_number: fields.external_invoice_number.trim(),
      invoice_date: fields.invoice_date || null,
      due_date: fields.due_date || null,
      amount_net: importMoneyCents(fields.amount_net)! / 100,
      amount_vat: importMoneyCents(fields.amount_vat)! / 100,
      amount_gross: importMoneyCents(fields.amount_gross)! / 100,
      currency: fields.currency.trim().toUpperCase(),
      notes: notes.trim() || null,
    }),
  });
}

export function confirmInvoiceImport(
  documentId: string, patientId: string, orderId: string, fields: InvoiceImportFields, notes: string,
) {
  return apiFetch<{ id: string }>(`/orders/${orderId}/external-invoices`, {
    method: "POST", body: JSON.stringify({
      patient_id: patientId, source_document_id: documentId,
      external_invoice_number: fields.external_invoice_number.trim(),
      invoice_date: fields.invoice_date || null, due_date: fields.due_date || null,
      amount_net: importMoneyCents(fields.amount_net)! / 100,
      amount_vat: importMoneyCents(fields.amount_vat)! / 100,
      amount_gross: importMoneyCents(fields.amount_gross)! / 100,
      currency: fields.currency.trim().toUpperCase(), status: "received", paid_by: "unpaid",
      service_delivered: false,
      notes: [fields.supplier_name.trim(), notes.trim()].filter(Boolean).join("\n") || null,
    }),
  });
}
