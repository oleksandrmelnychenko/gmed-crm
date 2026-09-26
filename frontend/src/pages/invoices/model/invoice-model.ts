import { formatMoneyAmount, moneyLineAmounts, roundCents, toCents } from "@/lib/money";
import { hasCapability, type Actor } from "@/lib/permissions";

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
  QuoteOption,
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

/**
 * Manual status moves accepted by POST /invoices/{id}/status. `paid` and
 * `partially_paid` are derived from the payment journal and never picked by hand.
 */
const INVOICE_STATUS_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["sent", "cancelled"],
  sent: ["draft", "overdue", "cancelled"],
  partially_paid: ["sent", "overdue", "cancelled"],
  paid: [],
  overdue: ["sent", "cancelled"],
  cancelled: [],
};

export function canPickInvoiceStatus(current: string, next: InvoiceStatus): boolean {
  return (
    current === next ||
    (INVOICE_STATUS_TRANSITIONS[current as InvoiceStatus] ?? []).includes(next)
  );
}

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

export function invoicesPermissions(actor?: Actor): InvoicesPermissions {
  return {
    canView: hasCapability(actor, "invoices.view"),
    canCreate: hasCapability(actor, "invoices.create"),
    canManage: hasCapability(actor, "invoices.finance"),
    canAccounting: hasCapability(actor, "accounting.view"),
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

export function createInvoiceLineSelection(lines: InvoiceLineItem[], invoiceType: InvoiceType) {
  return {
    selectedLineIndexes: lines.flatMap((line, index) =>
      invoiceLineQuantityAvailable(line, invoiceType) > 0 ? [index] : [],
    ),
    lineQuantities: Object.fromEntries(lines.map((line, index) => [
      String(index), String(invoiceLineQuantityAvailable(line, invoiceType)),
    ])),
  };
}

export function isInvoiceSelectionValid(lines: InvoiceLineItem[], form: CreateForm) {
  const selected = new Set(form.selectedLineIndexes);
  if (!selected.size || selected.size !== form.selectedLineIndexes.length) return false;
  for (const index of selected) {
    const line = lines[index];
    const quantity = Number(form.lineQuantities[String(index)]);
    if (!line || !Number.isFinite(quantity) || quantity <= 0 ||
      quantity > invoiceLineQuantityAvailable(line, form.invoiceType)) return false;
    if (form.invoiceType === "final" &&
      quantity !== invoiceLineQuantityAvailable(line, form.invoiceType)) return false;
  }
  return form.invoiceType !== "final" || lines.every((line, index) =>
    invoiceLineQuantityAvailable(line, "final") === 0 || selected.has(index),
  );
}

// Nothing can be invoiced from these quotes any more. A quote is superseded when
// a newer quote of the same order was created; its issued invoices stay valid.
const CLOSED_QUOTE_STATUSES = new Set(["rejected", "expired", "superseded"]);

export function isQuoteClosedForInvoicing(status: string | null | undefined) {
  return CLOSED_QUOTE_STATUSES.has(status ?? "");
}

// Paid advances still need a settlement invoice. Availability is determined by
// the unbilled scope and active invoice types, not the quote's payment total.
export function isQuoteAvailableForInvoice(quote: QuoteOption, invoiceType: InvoiceType) {
  if (!quote.patient_id || isQuoteClosedForInvoicing(quote.status)) return false;
  if (quote.active_invoice_types?.includes("final")) return false;
  if (invoiceType === "advance" && quote.active_invoice_types?.includes("advance")) return false;
  return quote.line_items.some((line) => invoiceLineQuantityAvailable(line, "final") > 0);
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
      // Same per-line rounding as the server invoice (half away from zero).
      const {
        net: lineNet,
        vat: lineVat,
        gross: lineGross,
      } = moneyLineAmounts(quantity, unitPrice, vatRate);
      return {
        net: roundCents(totals.net + lineNet),
        vat: roundCents(totals.vat + lineVat),
        gross: roundCents(totals.gross + lineGross),
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
    // Date-only values are local calendar days; timestamps such as paid_at
    // already carry a time and zone.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00`)
      : new Date(value);
    return invoiceDateFormatter(locale).format(date);
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

export function formatCurrency(value: unknown, _locale = "de-DE", currency = "EUR") {
  void _locale;
  return formatMoneyAmount(value, currency);
}

/**
 * Whether credited advances alone settled the invoice: no cash on the invoice
 * itself and nothing left to pay. A partly credited invoice is not "covered".
 */
export function isCoveredByPrepaymentOnly(
  invoice: Pick<InvoiceItem, "paid_amount" | "prepayment_applied_amount" | "balance_due">,
) {
  return (
    toCents(Number(invoice.paid_amount ?? 0)) === 0 &&
    toCents(Number(invoice.prepayment_applied_amount ?? 0)) > 0 &&
    toCents(Number(invoice.balance_due ?? 0)) <= 0
  );
}

export function nextDunningLevel(events: DunningEvent[]) {
  const levels = new Set(events.map((event) => event.level));
  if (!levels.has("first")) return "first";
  if (!levels.has("second")) return "second";
  if (!levels.has("collections")) return "collections";
  return null;
}
