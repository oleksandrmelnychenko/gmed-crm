import { apiFetch } from "@/lib/api";

import type {
  CompanyFinancialFilters,
  CompanyFinancialAccountsPayload,
  CompanyFinancialPosition,
} from "./types";

export function buildCompanyFinancialPositionPath(filters: CompanyFinancialFilters) {
  const params = new URLSearchParams();
  params.set("from", filters.from);
  params.set("to", filters.to);
  if (filters.currency) params.set("currency", filters.currency);
  if (filters.movement !== "all") params.set("movement", filters.movement);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  return `/company-financial-position?${params.toString()}`;
}

export function fetchCompanyFinancialPosition(
  filters: CompanyFinancialFilters,
  forceFresh = false,
) {
  return apiFetch<CompanyFinancialPosition>(buildCompanyFinancialPositionPath(filters), {
    forceFresh,
  });
}

type JsonPayload = Record<string, unknown>;

function postJson<T>(path: string, payload: JsonPayload) {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchCompanyFinancialAccounts(currency: string, forceFresh = false) {
  const query = currency ? `?currency=${encodeURIComponent(currency)}&include_inactive=true` : "";
  return apiFetch<CompanyFinancialAccountsPayload>(`/company-financial-accounts${query}`, {
    forceFresh,
  });
}

export function createCompanyFinancialAccount(payload: JsonPayload) {
  return postJson<{ id: string }>("/company-financial-accounts", payload);
}

export function updateCompanyFinancialAccount(accountId: string, payload: JsonPayload) {
  return postJson<{ id: string }>(`/company-financial-accounts/${accountId}`, payload);
}

export function createCompanyFinancialAccountAdjustment(
  accountId: string,
  payload: JsonPayload,
) {
  return postJson<{ id: string; idempotent_replay: boolean }>(
    `/company-financial-accounts/${accountId}/adjustments`,
    payload,
  );
}

export function reverseCompanyFinancialAccountAdjustment(
  accountId: string,
  adjustmentId: string,
  payload: JsonPayload,
) {
  return postJson<{ id: string; idempotent_replay: boolean }>(
    `/company-financial-accounts/${accountId}/adjustments/${adjustmentId}/reversal`,
    payload,
  );
}

export function assignAccountingEntryFinancialAccount(
  entryId: string,
  financialAccountId: string,
) {
  return postJson<{ updated_count: number; idempotent_replay: boolean }>(
    `/accounting-entries/${entryId}/financial-account`,
    { financial_account_id: financialAccountId },
  );
}

export function createCompanyFinancialAccountTransfer(payload: JsonPayload) {
  return postJson<{ id: string; idempotent_replay: boolean }>(
    "/company-financial-account-transfers",
    payload,
  );
}

export function reverseCompanyFinancialAccountTransfer(
  transferId: string,
  payload: JsonPayload,
) {
  return postJson<{ id: string; idempotent_replay: boolean }>(
    `/company-financial-account-transfers/${transferId}/reversal`,
    payload,
  );
}
