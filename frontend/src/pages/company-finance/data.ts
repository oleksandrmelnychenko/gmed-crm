import { apiFetch, apiFetchFile, downloadApiFile } from "@/lib/api";

import type {
  CompanyFinancialFilters,
  CompanyFinancialAccountsPayload,
  CompanyFinancialPosition,
  CompanyProviderPaymentTransaction,
  CompanyProviderFinancialSummary,
  CompanyProviderSettlement,
  CompanyProviderStatement,
  CompanyConciergeExpenseContext,
  CompanyConciergeExpenseMutationResponse,
  CompanyConciergeExpensePostPayload,
  CompanyConciergeExpenseReversePayload,
  CompanyConciergeExpenseQueuePayload,
  CompanyConciergeExpenseReviewQueuePage,
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

export function fetchCompanyProviderSettlement(
  externalInvoiceId: string,
  forceFresh = false,
) {
  return apiFetch<CompanyProviderSettlement>(
    `/company-provider-liabilities/${externalInvoiceId}/settlements`,
    { forceFresh },
  );
}

export function createCompanyProviderPayment(
  externalInvoiceId: string,
  payload: JsonPayload,
) {
  return postJson<{
    transaction: CompanyProviderPaymentTransaction;
    idempotent_replay: boolean;
  }>(`/company-provider-liabilities/${externalInvoiceId}/settlements`, payload);
}

export function reverseCompanyProviderPayment(
  externalInvoiceId: string,
  paymentId: string,
  payload: JsonPayload,
) {
  return postJson<{
    transaction: CompanyProviderPaymentTransaction;
    idempotent_replay: boolean;
  }>(
    `/company-provider-liabilities/${externalInvoiceId}/settlements/${paymentId}/reversal`,
    payload,
  );
}

export function fetchCompanyProviderStatement(
  providerId: string,
  filters: Pick<CompanyFinancialFilters, "from" | "to" | "currency">,
  forceFresh = false,
) {
  return apiFetch<CompanyProviderStatement>(
    buildCompanyProviderStatementPath(providerId, filters),
    { forceFresh },
  );
}

export function fetchCompanyProviderFinancialSummary(
  providerId: string,
  currency = "EUR",
  forceFresh = false,
) {
  return apiFetch<CompanyProviderFinancialSummary>(
    buildCompanyProviderFinancialSummaryPath(providerId, currency),
    { forceFresh },
  );
}

export function buildCompanyProviderFinancialSummaryPath(
  providerId: string,
  currency = "EUR",
) {
  const params = new URLSearchParams({ currency: currency || "EUR" });
  return `/company-provider-statements/${providerId}/summary?${params.toString()}`;
}

export function buildCompanyProviderStatementPath(
  providerId: string,
  filters: Pick<CompanyFinancialFilters, "from" | "to" | "currency">,
) {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    currency: filters.currency || "EUR",
  });
  return `/company-provider-statements/${providerId}?${params.toString()}`;
}

const EXPENSE_QUEUE_PAGE_SIZE = 100;

export async function fetchCompanyConciergeExpenseQueue(
  forceFresh = false,
): Promise<CompanyConciergeExpenseQueuePayload> {
  const rows = [] as CompanyConciergeExpenseReviewQueuePage["items"];
  let page = 1;
  let totalCount = 0;
  let hasMore = true;
  while (hasMore) {
    const response = await apiFetch<CompanyConciergeExpenseReviewQueuePage>(
      `/concierge-expenses?page=${page}&page_size=${EXPENSE_QUEUE_PAGE_SIZE}`,
      { forceFresh },
    );
    if (response.page !== page || response.page_size !== EXPENSE_QUEUE_PAGE_SIZE) {
      throw new Error("Expense review queue returned an invalid page");
    }
    if (response.has_more && response.items.length === 0) {
      throw new Error("Expense review queue pagination did not advance");
    }
    rows.push(...response.items);
    totalCount = response.total;
    hasMore = response.has_more;
    page += 1;
  }
  return {
    rows,
    total_count: totalCount,
    loaded_count: rows.length,
    complete: rows.length === totalCount,
  };
}

export function buildCompanyTaskExpenseContextPath(taskId: string) {
  return `/tasks/${taskId}/expense-context`;
}

export function buildCompanyTaskExpenseActionPath(
  taskId: string,
  expenseId: string,
  action: "post" | "reject" | "reverse",
) {
  return `/tasks/${taskId}/expenses/${expenseId}/${action}`;
}

export function buildCompanyTaskExpenseReceiptPath(taskId: string, expenseId: string) {
  return `/tasks/${taskId}/expenses/${expenseId}/receipt`;
}

export function fetchCompanyConciergeExpenseContext(taskId: string) {
  return apiFetch<CompanyConciergeExpenseContext>(
    buildCompanyTaskExpenseContextPath(taskId),
    { forceFresh: true },
  );
}

export function postCompanyConciergeExpense(
  taskId: string,
  expenseId: string,
  payload: CompanyConciergeExpensePostPayload,
) {
  return apiFetch<CompanyConciergeExpenseMutationResponse>(
    buildCompanyTaskExpenseActionPath(taskId, expenseId, "post"),
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function rejectCompanyConciergeExpense(
  taskId: string,
  expenseId: string,
  payload: { request_id: string; reason: string },
) {
  return apiFetch<CompanyConciergeExpenseMutationResponse>(
    buildCompanyTaskExpenseActionPath(taskId, expenseId, "reject"),
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function reverseCompanyConciergeExpense(
  taskId: string,
  expenseId: string,
  payload: CompanyConciergeExpenseReversePayload,
) {
  return apiFetch<CompanyConciergeExpenseMutationResponse>(
    buildCompanyTaskExpenseActionPath(taskId, expenseId, "reverse"),
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function fetchCompanyConciergeExpenseReceipt(taskId: string, expenseId: string) {
  return apiFetchFile(
    buildCompanyTaskExpenseReceiptPath(taskId, expenseId),
  );
}

export function downloadCompanyConciergeExpenseReceipt(
  taskId: string,
  expenseId: string,
  fallbackFilename: string,
) {
  return downloadApiFile(
    buildCompanyTaskExpenseReceiptPath(taskId, expenseId),
    fallbackFilename,
  );
}
