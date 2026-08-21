import { formatMoneyAmount } from "@/lib/money";

import type {
  AccountingLedgerPayload,
  CreateForm,
  DunningEvent,
  Filters,
  InvoiceItem,
  InvoiceLineItem,
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

export const DEFAULT_INVOICE_PAGE_SIZE = 50;

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

function invoiceDateFormatter(locale: string) {
  return dateFormatters.get(locale) ?? dateFormatters.get("en-GB")!;
}

function invoiceDateTimeFormatter(locale: string) {
  return dateTimeFormatters.get(locale) ?? dateTimeFormatters.get("en-GB")!;
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
  return {
    quoteId,
    invoiceType: "final",
    dueDate: "",
    notes: "",
    selectedLineIndexes: [],
    lineQuantities: {},
  };
}

function roundInvoiceMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function invoiceLineQuantityAvailable(
  line: InvoiceLineItem,
  invoiceType: InvoiceType,
) {
  const value = invoiceType === "advance"
    ? line.quantity
    : (line.remaining_quantity ?? line.quantity);
  const quantity = Number(value ?? 0);
  return Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
}

export function calculateInvoiceSelectionTotals(
  lines: InvoiceLineItem[],
  selectedLineIndexes: number[],
  lineQuantities: Record<string, string>,
) {
  const selected = new Set(selectedLineIndexes);
  return lines.reduce(
    (totals, line, lineIndex) => {
      if (!selected.has(lineIndex)) return totals;
      const quantity = Number(lineQuantities[String(lineIndex)] ?? 0);
      const unitPrice = Number(line.unit_price ?? 0);
      const vatRate = Number(line.vat_rate ?? 0);
      if (
        !Number.isFinite(quantity) ||
        !Number.isFinite(unitPrice) ||
        !Number.isFinite(vatRate) ||
        quantity <= 0 ||
        unitPrice < 0 ||
        vatRate < 0
      ) {
        return totals;
      }
      const lineNet = roundInvoiceMoney(quantity * unitPrice);
      const lineVat = roundInvoiceMoney((lineNet * vatRate) / 100);
      const lineGross = roundInvoiceMoney(lineNet + lineVat);
      return {
        net: roundInvoiceMoney(totals.net + lineNet),
        vat: roundInvoiceMoney(totals.vat + lineVat),
        gross: roundInvoiceMoney(totals.gross + lineGross),
        lineGrossByIndex: {
          ...totals.lineGrossByIndex,
          [lineIndex]: lineGross,
        },
      };
    },
    {
      net: 0,
      vat: 0,
      gross: 0,
      lineGrossByIndex: {} as Record<number, number>,
    },
  );
}

export function invoiceToStatusForm(invoice: InvoiceItem): StatusForm {
  return {
    status: (invoice.status as InvoiceStatus) ?? "draft",
    dueDate: invoice.due_date ?? "",
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

export function formatCurrency(value: unknown, _locale = "de-DE") {
  void _locale;
  return formatMoneyAmount(value);
}

export function nextDunningLevel(events: DunningEvent[]) {
  const levels = new Set(events.map((event) => event.level));
  if (!levels.has("first")) return "first";
  if (!levels.has("second")) return "second";
  if (!levels.has("collections")) return "collections";
  return null;
}
