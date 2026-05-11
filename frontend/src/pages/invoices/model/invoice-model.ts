import type {
  AccountingLedgerPayload,
  CreateForm,
  DunningEvent,
  Filters,
  InvoiceItem,
  InvoiceStatus,
  InvoiceType,
  InvoicesPermissions,
  PayerForm,
  StatusForm,
  VisibilityForm,
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

const DEFAULT_INVOICE_PAGE_SIZE = 12;

const INVOICE_DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};
const INVOICE_DATE_TIME_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  ...INVOICE_DATE_FORMAT_OPTIONS,
  hour: "2-digit",
  minute: "2-digit",
};
const INVOICE_CURRENCY_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

const dateFormatters = new Map<string, Intl.DateTimeFormat>([
  ["de-DE", new Intl.DateTimeFormat("de-DE", INVOICE_DATE_FORMAT_OPTIONS)],
  ["ru-RU", new Intl.DateTimeFormat("ru-RU", INVOICE_DATE_FORMAT_OPTIONS)],
  ["en-GB", new Intl.DateTimeFormat("en-GB", INVOICE_DATE_FORMAT_OPTIONS)],
]);
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>([
  ["de-DE", new Intl.DateTimeFormat("de-DE", INVOICE_DATE_TIME_FORMAT_OPTIONS)],
  ["ru-RU", new Intl.DateTimeFormat("ru-RU", INVOICE_DATE_TIME_FORMAT_OPTIONS)],
  ["en-GB", new Intl.DateTimeFormat("en-GB", INVOICE_DATE_TIME_FORMAT_OPTIONS)],
]);
const currencyFormatters = new Map<string, Intl.NumberFormat>([
  ["de-DE", new Intl.NumberFormat("de-DE", INVOICE_CURRENCY_FORMAT_OPTIONS)],
  ["ru-RU", new Intl.NumberFormat("ru-RU", INVOICE_CURRENCY_FORMAT_OPTIONS)],
  ["en-GB", new Intl.NumberFormat("en-GB", INVOICE_CURRENCY_FORMAT_OPTIONS)],
]);

function invoiceDateFormatter(locale: string) {
  return dateFormatters.get(locale) ?? dateFormatters.get("en-GB")!;
}

function invoiceDateTimeFormatter(locale: string) {
  return dateTimeFormatters.get(locale) ?? dateTimeFormatters.get("en-GB")!;
}

function invoiceCurrencyFormatter(locale: string) {
  return currencyFormatters.get(locale) ?? currencyFormatters.get("en-GB")!;
}

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

export function invoiceToVisibilityForm(invoice: InvoiceItem): VisibilityForm {
  return {
    portalVisible: invoice.portal_visible ?? true,
    hideAmountsFromPatient: invoice.hide_amounts_from_patient ?? false,
    lineItemsVisibleToPatient: invoice.line_items_visible_to_patient ?? true,
    pdfVisibleToPatient: invoice.pdf_visible_to_patient ?? true,
    visibilityNote: invoice.visibility_note ?? "",
  };
}

export function invoiceToPayerForm(invoice: InvoiceItem): PayerForm {
  return {
    payerPatientRelationId: invoice.payer?.patient_relation_id ?? "",
    contactName: invoice.payer?.contact_name ?? "",
    contactEmail: invoice.payer?.contact_email ?? "",
    contactPhone: invoice.payer?.contact_phone ?? "",
    contactRelationship: invoice.payer?.contact_relationship ?? "",
    notes: invoice.payer?.notes ?? "",
  };
}

export function formatDate(
  value?: string | null,
  locale = "de-DE",
  emptyLabel = "-",
) {
  if (!value) return emptyLabel;
  try {
    return invoiceDateFormatter(locale).format(new Date(`${value}T00:00:00`));
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
    return invoiceDateTimeFormatter(locale).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatCurrency(value: unknown, locale = "de-DE") {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return invoiceCurrencyFormatter(locale).format(Number.isFinite(numeric) ? numeric : 0);
}

export function nextDunningLevel(events: DunningEvent[]) {
  const levels = new Set(events.map((event) => event.level));
  if (!levels.has("first")) return "first";
  if (!levels.has("second")) return "second";
  if (!levels.has("collections")) return "collections";
  return null;
}
