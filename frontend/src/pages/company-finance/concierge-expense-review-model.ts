import type {
  CompanyConciergeExpenseContext,
  CompanyConciergeExpenseItem,
  CompanyConciergeExpensePostPayload,
  CompanyConciergeExpensePaymentMethod,
  CompanyConciergeExpenseReviewRow,
  CompanyConciergeExpenseStatus,
  CompanyConciergeServiceSummary,
  CompanyFinancialAccount,
} from "./types";

export type ExpenseQueueSource = {
  service: CompanyConciergeServiceSummary;
  items: CompanyConciergeExpenseItem[];
};

export type ExpenseReviewFilter = CompanyConciergeExpenseStatus | "all";

export type ExpensePostForm = {
  orderId: string;
  orderLeistungId: string;
  financialAccountId: string;
  paidOn: string;
  paymentMethod: CompanyConciergeExpensePaymentMethod;
  paymentReference: string;
};

export type ExpensePostValidationError =
  | "order_required"
  | "order_invalid"
  | "order_locked"
  | "order_service_invalid"
  | "order_service_locked"
  | "provider_required"
  | "paid_on_required"
  | "paid_on_invalid"
  | "financial_account_required"
  | "financial_account_invalid"
  | "payment_reference_required";

export type StableRequestIdEntry = {
  fingerprint: string;
  requestId: string;
};

const statusRank: Record<CompanyConciergeExpenseStatus, number> = {
  pending_review: 0,
  posted: 1,
  rejected: 2,
  reversed: 3,
};

export function conciergeExpenseQueueCompleteness(
  serviceCount: number,
  failedServiceCount: number,
) {
  const serviceListTruncated = serviceCount >= 200;
  return {
    service_list_truncated: serviceListTruncated,
    complete: failedServiceCount === 0 && !serviceListTruncated,
  };
}

export function mergeConciergeExpenseQueue(sources: ExpenseQueueSource[]) {
  return sources
    .flatMap(({ service, items }) => items.map((item) => ({ ...item, service })))
    .sort((left, right) => {
      const byStatus = statusRank[left.status] - statusRank[right.status];
      if (byStatus !== 0) return byStatus;
      return (right.submitted_at ?? "").localeCompare(left.submitted_at ?? "");
    });
}

export function filterConciergeExpenseQueue(
  rows: CompanyConciergeExpenseReviewRow[],
  status: ExpenseReviewFilter,
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    if (!needle) return true;
    return [
      row.vendor,
      row.service.patient_name,
      row.service.patient_pid,
      row.service.title,
      row.order_number,
      row.order_leistung_name,
      row.submitted_by.display_name,
    ].some((value) => value?.toLocaleLowerCase().includes(needle));
  });
}

export function eligibleExpenseOrders(
  expense: CompanyConciergeExpenseItem,
  context: CompanyConciergeExpenseContext,
) {
  return context.eligible_orders.filter((order) => (
    order.status !== "cancelled"
    && order.currency.toLocaleUpperCase() === expense.currency.toLocaleUpperCase()
    && (!expense.order_id || order.id === expense.order_id)
  ));
}

export function eligibleExpenseOrderServices(
  expense: CompanyConciergeExpenseItem,
  context: CompanyConciergeExpenseContext,
  orderId: string,
) {
  const serviceProviderId = context.service.provider_id;
  const order = eligibleExpenseOrders(expense, context).find((candidate) => candidate.id === orderId);
  return (order?.leistungen ?? []).filter((service) => (
    (!expense.order_leistung_id || service.id === expense.order_leistung_id)
    && (!serviceProviderId || !service.provider_id || service.provider_id === serviceProviderId)
  ));
}

export function validateExpensePostForm(
  expense: CompanyConciergeExpenseItem,
  context: CompanyConciergeExpenseContext,
  accounts: CompanyFinancialAccount[],
  form: ExpensePostForm,
  today: string,
): ExpensePostValidationError[] {
  const errors: ExpensePostValidationError[] = [];
  const order = eligibleExpenseOrders(expense, context).find((candidate) => candidate.id === form.orderId);
  if (!form.orderId) errors.push("order_required");
  else if (!order) errors.push("order_invalid");
  if (expense.order_id && form.orderId !== expense.order_id) errors.push("order_locked");

  const orderService = eligibleExpenseOrderServices(expense, context, form.orderId)
    .find((candidate) => candidate.id === form.orderLeistungId);
  if (form.orderLeistungId && !orderService) errors.push("order_service_invalid");
  if (expense.order_leistung_id && form.orderLeistungId !== expense.order_leistung_id) {
    errors.push("order_service_locked");
  }
  if (
    expense.paid_by !== "patient"
    && !context.service.provider_id
    && !orderService?.provider_id
  ) {
    errors.push("provider_required");
  }

  if (expense.paid_by === "agency") {
    if (!form.paidOn) errors.push("paid_on_required");
    else if (form.paidOn < expense.expense_date || form.paidOn > today) {
      errors.push("paid_on_invalid");
    }
    if (!form.financialAccountId) errors.push("financial_account_required");
    else {
      const account = accounts.find((candidate) => candidate.id === form.financialAccountId);
      if (
        !account
        || !account.is_active
        || account.currency.toLocaleUpperCase() !== expense.currency.toLocaleUpperCase()
        || (form.paidOn && account.opening_balance_on > form.paidOn)
      ) {
        errors.push("financial_account_invalid");
      }
    }
    if (!form.paymentReference.trim()) errors.push("payment_reference_required");
  }
  return [...new Set(errors)];
}

export function buildExpensePostPayload(
  expense: CompanyConciergeExpenseItem,
  form: ExpensePostForm,
  requestId: string,
): CompanyConciergeExpensePostPayload {
  const agency = expense.paid_by === "agency";
  return {
    request_id: requestId,
    order_id: form.orderId,
    order_leistung_id: form.orderLeistungId || null,
    financial_account_id: agency ? form.financialAccountId || null : null,
    paid_on: agency ? form.paidOn || null : null,
    payment_method: agency ? form.paymentMethod : null,
    payment_reference: agency ? form.paymentReference.trim() || null : null,
  };
}

export function validateExpenseRejection(reason: string) {
  const length = [...reason.trim()].length;
  return length >= 1 && length <= 2000;
}

export function resolveStableRequestId(
  registry: Map<string, StableRequestIdEntry>,
  key: string,
  payload: unknown,
  generate: () => string,
) {
  const fingerprint = JSON.stringify(payload);
  const existing = registry.get(key);
  if (existing?.fingerprint === fingerprint) return existing.requestId;
  const requestId = generate();
  registry.set(key, { fingerprint, requestId });
  return requestId;
}
