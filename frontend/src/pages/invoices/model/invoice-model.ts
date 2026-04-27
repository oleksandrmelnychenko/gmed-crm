import type {
  AccountingLedgerPayload,
  CreateForm,
  DunningEvent,
  Filters,
  InvoiceItem,
  InvoiceStatus,
  InvoiceType,
  InvoicesPermissions,
  StatusForm,
} from "./types";

export const INVOICE_TYPES: InvoiceType[] = ["advance", "interim", "final"];

export const INVOICE_STATUSES: InvoiceStatus[] = [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
];

export const DEFAULT_FILTERS: Filters = {
  search: "",
  patientId: "",
  orderId: "",
  quoteId: "",
  status: "",
  invoiceType: "",
};

export const DEFAULT_INVOICE_PAGE_SIZE = 12;

export const EMPTY_ACCOUNTING_SUMMARY: AccountingLedgerPayload["summary"] = {
  income_gross: "0.00",
  expense_gross: "0.00",
  net_surplus: "0.00",
  service_revenue_gross: "0.00",
  cost_passthrough_revenue_gross: "0.00",
  provider_expense_gross: "0.00",
};

export function invoicesPermissions(role?: string): InvoicesPermissions {
  return {
    canView:
      role === "ceo" ||
      role === "ceo_assistant" ||
      role === "patient_manager" ||
      role === "billing",
    canCreate: role === "ceo" || role === "patient_manager" || role === "billing",
    canManage: role === "ceo" || role === "billing",
    canAccounting: role === "ceo" || role === "ceo_assistant" || role === "billing",
  };
}

export function buildInvoicesPath(
  filters: Filters,
  page: number,
  perPage = DEFAULT_INVOICE_PAGE_SIZE,
) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.patientId) params.set("patient_id", filters.patientId);
  if (filters.orderId) params.set("order_id", filters.orderId);
  if (filters.quoteId) params.set("quote_id", filters.quoteId);
  if (filters.status) params.set("status", filters.status);
  if (filters.invoiceType) params.set("invoice_type", filters.invoiceType);
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  return params.size ? `/invoices?${params.toString()}` : "/invoices";
}

export function buildSearchParams(
  current: URLSearchParams,
  patch: Record<string, string | null | undefined>,
) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (!value) next.delete(key);
    else next.set(key, value);
  }
  return next;
}

export function blankCreateForm(quoteId = ""): CreateForm {
  return { quoteId, invoiceType: "final", dueDate: "", notes: "" };
}

export function invoiceToStatusForm(invoice: InvoiceItem): StatusForm {
  return {
    status: (invoice.status as InvoiceStatus) ?? "draft",
    dueDate: invoice.due_date ?? "",
    paidAmount:
      invoice.paid_amount === null || invoice.paid_amount === undefined
        ? ""
        : String(invoice.paid_amount),
    notes: invoice.notes ?? "",
  };
}

export function formatDate(
  value?: string | null,
  locale = "de-DE",
  emptyLabel = "-",
) {
  if (!value) return emptyLabel;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

export function formatDateTime(
  value?: string | null,
  locale = "de-DE",
  emptyLabel = "-",
) {
  if (!value) return emptyLabel;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatCurrency(value: unknown, locale = "de-DE") {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(0);
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
}

export function nextDunningLevel(events: DunningEvent[]) {
  const levels = new Set(events.map((event) => event.level));
  if (!levels.has("first")) return "first";
  if (!levels.has("second")) return "second";
  if (!levels.has("collections")) return "collections";
  return null;
}

export function enumLabel(value: string, labels: Record<string, string>) {
  return labels[value] ?? value.replaceAll("_", " ");
}
