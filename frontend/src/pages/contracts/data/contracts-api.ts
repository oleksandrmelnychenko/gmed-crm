import { apiFetch } from "@/lib/api";

import type {
  AgencyServiceItem,
  ContractItem,
  OrderOption,
  PatientOption,
  QuoteItem,
  QuoteVersionItem,
} from "../model/types";

type JsonPayload = Record<string, unknown>;

const CONTRACT_LOOKUPS_CACHE_TTL_MS = 60_000;
const CONTRACT_CATALOG_CACHE_TTL_MS = 300_000;

function postJson<T>(path: string, payload: JsonPayload) {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchContractsLookups() {
  const [patients, orders] = await Promise.all([
    apiFetch<PatientOption[]>("/patients?active_only=false", {
      cacheTtlMs: CONTRACT_LOOKUPS_CACHE_TTL_MS,
    }),
    apiFetch<OrderOption[]>("/orders", {
      cacheTtlMs: CONTRACT_LOOKUPS_CACHE_TTL_MS,
    }),
  ]);
  return { patients, orders };
}

export function fetchContracts(path: string) {
  return apiFetch<ContractItem[]>(path);
}

export function fetchQuotes(path: string) {
  return apiFetch<QuoteItem[]>(path);
}

export function fetchAgencyServices(path: string) {
  return apiFetch<AgencyServiceItem[]>(path, {
    cacheTtlMs: CONTRACT_CATALOG_CACHE_TTL_MS,
  });
}

export function fetchContract(contractId: string) {
  return apiFetch<ContractItem>(`/framework-contracts/${contractId}`);
}

export async function fetchQuoteWorkspace(quoteId: string) {
  const [quote, versions] = await Promise.all([
    apiFetch<QuoteItem>(`/quotes/${quoteId}`),
    apiFetch<QuoteVersionItem[]>(`/quotes/${quoteId}/versions`),
  ]);
  return { quote, versions };
}

export function createContract(payload: JsonPayload) {
  return postJson<{ id: string } & Partial<ContractItem>>(
    "/framework-contracts",
    payload,
  );
}

export function createQuote(orderId: string, payload: JsonPayload) {
  return postJson<
    Partial<QuoteItem> &
      Pick<
        QuoteItem,
        | "id"
        | "order_id"
        | "quote_number"
        | "status"
        | "total_net"
        | "total_vat"
        | "total_gross"
        | "created_at"
        | "updated_at"
      >
  >(`/orders/${orderId}/quotes`, payload);
}

export function saveAgencyService(serviceId: string, payload: JsonPayload) {
  const path = serviceId ? `/agency-services/${serviceId}/update` : "/agency-services";
  return postJson<void>(path, payload);
}

export function updateContractStatus(contractId: string, payload: JsonPayload) {
  return postJson<ContractItem>(`/framework-contracts/${contractId}/status`, payload);
}

export function updateQuoteStatus(quoteId: string, payload: JsonPayload) {
  return postJson<QuoteItem>(`/quotes/${quoteId}/status`, payload);
}
