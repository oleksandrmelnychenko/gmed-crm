import { apiFetch, apiFetchFile } from "@/lib/api";

import type {
  AccountingLedgerPayload,
  DunningEvent,
  InvoiceItem,
  InvoiceListResponse,
  InvoicePaymentHistoryResponse,
  OrderOption,
  PatientOption,
  QuoteOption,
} from "../model/types";

type JsonPayload = Record<string, unknown>;

const INVOICE_LOOKUPS_CACHE_TTL_MS = 60_000;

function postJson<T>(path: string, payload: JsonPayload) {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function fetchProtectedBlob(path: string) {
  const { blob } = await apiFetchFile(path);
  return blob;
}

export async function fetchInvoiceLookups(
  canLoadOrderOptions: boolean,
  canLoadQuoteOptions: boolean,
) {
  const [patients, orders, quotes] = await Promise.all([
    apiFetch<PatientOption[]>("/patients?active_only=false", {
      cacheTtlMs: INVOICE_LOOKUPS_CACHE_TTL_MS,
    }),
    canLoadOrderOptions
      ? apiFetch<OrderOption[]>("/orders", {
          cacheTtlMs: INVOICE_LOOKUPS_CACHE_TTL_MS,
        })
      : Promise.resolve([]),
    canLoadQuoteOptions
      ? apiFetch<QuoteOption[]>("/quotes", {
          cacheTtlMs: INVOICE_LOOKUPS_CACHE_TTL_MS,
        })
      : Promise.resolve([]),
  ]);
  return { patients, orders, quotes };
}

export function fetchInvoices(path: string) {
  return apiFetch<InvoiceListResponse>(path);
}

export async function fetchInvoiceWorkspace(invoiceId: string) {
  const [invoice, dunning, payments] = await Promise.all([
    apiFetch<InvoiceItem>(`/invoices/${invoiceId}`),
    apiFetch<DunningEvent[]>(`/invoices/${invoiceId}/dunning`),
    apiFetch<InvoicePaymentHistoryResponse>(`/invoices/${invoiceId}/payments`),
  ]);
  return { invoice, dunning, payments: payments.items };
}

export function fetchAccountingLedger(year: string) {
  return apiFetch<AccountingLedgerPayload>(
    `/invoices/accounting-ledger?year=${encodeURIComponent(year)}`,
  );
}

export function createInvoice(quoteId: string, payload: JsonPayload) {
  return postJson<InvoiceItem>(`/quotes/${quoteId}/invoices`, payload);
}

export function updateInvoiceStatus(invoiceId: string, payload: JsonPayload) {
  return postJson<InvoiceItem>(`/invoices/${invoiceId}/status`, payload);
}

export function createInvoicePayment(invoiceId: string, payload: JsonPayload) {
  return postJson(`/invoices/${invoiceId}/payments`, payload);
}

export function reverseInvoicePayment(
  invoiceId: string,
  paymentId: string,
  payload: JsonPayload,
) {
  return postJson(
    `/invoices/${invoiceId}/payments/${paymentId}/reversal`,
    payload,
  );
}

export function updateInvoiceVisibility(invoiceId: string, payload: JsonPayload) {
  return postJson<InvoiceItem>(`/invoices/${invoiceId}/visibility`, payload);
}

export function updateInvoicePayer(invoiceId: string, payload: JsonPayload) {
  return postJson<InvoiceItem>(`/invoices/${invoiceId}/payer`, payload);
}

export function applyInvoicePrepayment(invoiceId: string, payload: JsonPayload) {
  return postJson<InvoiceItem>(
    `/invoices/${invoiceId}/prepayment-allocations`,
    payload,
  );
}

export function releaseInvoicePrepayment(
  invoiceId: string,
  allocationId: string,
) {
  return apiFetch<InvoiceItem>(
    `/invoices/${invoiceId}/prepayment-allocations/${allocationId}`,
    { method: "DELETE" },
  );
}

export function createDunningEvent(invoiceId: string, payload: JsonPayload) {
  return postJson<DunningEvent>(`/invoices/${invoiceId}/dunning`, payload);
}

export function fetchInvoicePdfBlob(invoiceId: string) {
  return fetchProtectedBlob(`/invoices/${invoiceId}/pdf`);
}

export function fetchAccountingLedgerExportBlob(year: string) {
  return fetchProtectedBlob(`/invoices/accounting-ledger/export?year=${year}`);
}
