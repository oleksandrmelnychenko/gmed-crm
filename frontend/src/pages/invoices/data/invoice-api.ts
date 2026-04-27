import { apiFetch, buildApiUrl, getAccessToken } from "@/lib/api";

import type {
  AccountingLedgerPayload,
  DunningEvent,
  InvoiceItem,
  InvoiceListResponse,
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
  const token = getAccessToken();
  const response = await fetch(buildApiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.blob();
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
  const [invoice, dunning] = await Promise.all([
    apiFetch<InvoiceItem>(`/invoices/${invoiceId}`),
    apiFetch<DunningEvent[]>(`/invoices/${invoiceId}/dunning`),
  ]);
  return { invoice, dunning };
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

export function createDunningEvent(invoiceId: string, payload: JsonPayload) {
  return postJson<DunningEvent>(`/invoices/${invoiceId}/dunning`, payload);
}

export function fetchInvoicePdfBlob(invoiceId: string) {
  return fetchProtectedBlob(`/invoices/${invoiceId}/pdf`);
}

export function fetchAccountingLedgerExportBlob(year: string) {
  return fetchProtectedBlob(`/invoices/accounting-ledger/export?year=${year}`);
}
