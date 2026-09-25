import { apiFetch, apiFetchFile } from "@/lib/api";

import type {
  AccountingLedgerPayload,
  DunningEvent,
  InvoiceItem,
  InvoiceCreditNoteHistoryResponse,
  InvoiceListResponse,
  InvoicePaymentHistoryResponse,
  InvoiceRefundHistoryResponse,
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
  const [patients, orders, recentQuotes, invoiceableQuotes] = await Promise.all([
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
    // The recent list is capped; open quotes are fetched separately so an
    // older one can still be invoiced.
    canLoadQuoteOptions
      ? apiFetch<QuoteOption[]>("/quotes?invoiceable=true", {
          cacheTtlMs: INVOICE_LOOKUPS_CACHE_TTL_MS,
        })
      : Promise.resolve([]),
  ]);
  return { patients, orders, quotes: mergeQuoteOptions(recentQuotes, invoiceableQuotes) };
}

export function mergeQuoteOptions(...lists: QuoteOption[][]) {
  const byId = new Map<string, QuoteOption>();
  for (const quote of lists.flat()) {
    if (!byId.has(quote.id)) byId.set(quote.id, quote);
  }
  return [...byId.values()];
}

export function fetchInvoices(path: string) {
  return apiFetch<InvoiceListResponse>(path);
}

export async function fetchInvoiceWorkspace(invoiceId: string) {
  const [invoice, dunning, payments, creditNotes, refunds] = await Promise.all([
    apiFetch<InvoiceItem>(`/invoices/${invoiceId}`),
    apiFetch<DunningEvent[]>(`/invoices/${invoiceId}/dunning`),
    apiFetch<InvoicePaymentHistoryResponse>(`/invoices/${invoiceId}/payments`),
    apiFetch<InvoiceCreditNoteHistoryResponse>(`/invoices/${invoiceId}/credit-notes`),
    apiFetch<InvoiceRefundHistoryResponse>(`/invoices/${invoiceId}/refunds`),
  ]);
  return {
    invoice,
    dunning,
    payments: payments.items,
    creditNotes: creditNotes.items,
    refunds: refunds.items,
  };
}

export function fetchAccountingLedger(year: string, currency = "EUR") {
  return apiFetch<AccountingLedgerPayload>(
    `/invoices/accounting-ledger?year=${encodeURIComponent(year)}&currency=${encodeURIComponent(currency)}`,
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

export function correctInvoicePayment(
  invoiceId: string,
  paymentId: string,
  payload: JsonPayload,
) {
  return postJson(
    `/invoices/${invoiceId}/payments/${paymentId}/correction`,
    payload,
  );
}

export function createInvoiceCreditNote(invoiceId: string, payload: JsonPayload) {
  return postJson(`/invoices/${invoiceId}/credit-notes`, payload);
}

export function reverseInvoiceCreditNote(
  invoiceId: string,
  creditNoteId: string,
  payload: JsonPayload,
) {
  return postJson(
    `/invoices/${invoiceId}/credit-notes/${creditNoteId}/reversal`,
    payload,
  );
}

export function createInvoiceRefund(invoiceId: string, payload: JsonPayload) {
  return postJson(`/invoices/${invoiceId}/refunds`, payload);
}

export function reverseInvoiceRefund(
  invoiceId: string,
  refundId: string,
  payload: JsonPayload,
) {
  return postJson(
    `/invoices/${invoiceId}/refunds/${refundId}/reversal`,
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

export function fetchInvoiceZugferdXmlBlob(invoiceId: string) {
  return fetchProtectedBlob(`/invoices/${invoiceId}/zugferd.xml`);
}

export function fetchAccountingLedgerExportBlob(year: string, currency = "EUR") {
  return fetchProtectedBlob(`/invoices/accounting-ledger/export?year=${encodeURIComponent(year)}&currency=${encodeURIComponent(currency)}`);
}
