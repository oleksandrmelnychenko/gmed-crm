import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarClock, Download, LoaderCircle, Plus, RefreshCw, Search, Wallet } from "lucide-react";

import {
  AdminInlineMetric,
  AdminSheetScaffold,
  AdminTableCard,
  AdminToolbar,
  SheetActionsFooter,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Banner as ShellBanner,
  PageHeader,
  StatusBadge,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
  tokens,
} from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { PatientInvoicesPage } from "@/pages/patients/portal-invoices-page";
import { cn } from "@/lib/utils";
import {
  dunningLevelTone,
  invoiceTypeTone,
  statusBadgeClass,
} from "./appearance/status-appearance";
import {
  createDunningEvent,
  createInvoice,
  fetchAccountingLedger,
  fetchAccountingLedgerExportBlob,
  fetchInvoiceLookups,
  fetchInvoicePdfBlob,
  fetchInvoiceWorkspace,
  fetchInvoices,
  updateInvoiceStatus,
} from "./data/invoice-api";
import {
  DEFAULT_FILTERS,
  EMPTY_ACCOUNTING_SUMMARY,
  INVOICE_STATUSES,
  INVOICE_TYPES,
  blankCreateForm,
  buildInvoicesPath,
  buildSearchParams,
  enumLabel,
  formatCurrency,
  formatDate,
  formatDateTime,
  invoiceToStatusForm,
  invoicesPermissions,
  nextDunningLevel,
} from "./model/invoice-model";
import type {
  AccountingEntry,
  AccountingLedgerPayload,
  AccountingMonthlyItem,
  CreateForm,
  DunningEvent,
  DunningForm,
  Filters,
  InvoiceItem,
  InvoiceStatus,
  InvoiceType,
  OrderOption,
  PatientOption,
  QuoteOption,
  StatusForm,
} from "./model/types";
const selectClassName = shellSelectClassName;
const textareaClassName = shellTextareaClass;

function openPdfBlobPreview(blob: Blob, popupMessage: string) {
  const url = URL.createObjectURL(blob);
  const previewWindow = window.open(url, "_blank", "noopener,noreferrer");
  if (!previewWindow) {
    URL.revokeObjectURL(url);
    throw new Error(popupMessage);
  }

  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function openInvoicePdfPreview(invoiceId: string, popupMessage: string) {
  const blob = await fetchInvoicePdfBlob(invoiceId);
  openPdfBlobPreview(blob, popupMessage);
}

async function downloadInvoicePdf(invoiceId: string, filename: string) {
  const blob = await fetchInvoicePdfBlob(invoiceId);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "invoice.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadAccountingLedgerExport(year: string) {
  const blob = await fetchAccountingLedgerExportBlob(year);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `accounting-ledger-${year}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function StaffInvoicesPage() {
  const { t, lang } = useLang();
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const access = invoicesPermissions(user?.role);
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const formatMoney = (value: unknown) => formatCurrency(value, locale);
  const text = {
    accessDenied: t.invoices_workspace_access_denied,
    workspaceKicker: t.invoices_workspace_kicker,
    workspaceDescription: t.invoices_workspace_description,
    refresh: t.invoices_workspace_refresh,
    newInvoice: t.invoices_workspace_new_invoice,
    grossTotal: t.invoices_workspace_gross_total,
    grossTotalDescription: t.invoices_workspace_gross_total_description,
    openBalance: t.invoices_workspace_open_balance,
    openBalanceDescription: t.invoices_workspace_open_balance_description,
    quotesReady: t.invoices_workspace_quotes_ready,
    quotesReadyDescription: t.invoices_workspace_quotes_ready_description,
    accountingTitle: t.invoices_workspace_accounting_title,
    accountingDescription: t.invoices_workspace_accounting_description,
    refreshLedger: t.invoices_workspace_refresh_ledger,
    exportCsv: t.invoices_workspace_export_csv,
    cashIncome: t.invoices_workspace_cash_income,
    cashExpense: t.invoices_workspace_cash_expense,
    euerSurplus: t.invoices_workspace_euer_surplus,
    costPassthroughRevenue: t.invoices_workspace_cost_passthrough_revenue,
    noAccountingEntries: t.invoices_workspace_no_accounting_entries,
    noAccountingEntriesDescription: t.invoices_workspace_no_accounting_entries_description,
    noOrder: t.invoices_workspace_no_order,
    noPatient: t.invoices_workspace_no_patient,
    net: t.invoices_workspace_net,
    gross: t.invoices_workspace_gross,
    monthlyEuer: t.invoices_workspace_monthly_euer,
    noCashMovement: t.invoices_workspace_no_cash_movement,
    income: t.invoices_workspace_income,
    expense: t.invoices_workspace_expense,
    surplus: t.invoices_workspace_surplus,
    searchPlaceholder: t.invoices_workspace_search_placeholder,
    allOrders: t.invoices_workspace_all_orders,
    allQuotes: t.invoices_workspace_all_quotes,
    emptyInvoicesDescription: t.invoices_workspace_empty_invoices_description,
    balance: t.invoices_workspace_balance,
    pageLabel: t.invoices_workspace_page_label,
    invoiceCount: t.invoices_workspace_invoice_count,
    previous: t.invoices_workspace_previous,
    next: t.invoices_workspace_next,
    createInvoiceDescription:
      lang === "de"
        ? "Erstelle eine Rechnung aus einem Angebots-Snapshot. Positionen und Summen werden beim Erstellen fixiert."
        : "Сформируйте счёт из снимка предложения. Позиции и суммы фиксируются в момент создания.",
    selectedQuoteSnapshot: t.invoices_workspace_selected_quote_snapshot,
    chooseQuote: t.invoices_workspace_choose_quote,
    notes: t.invoices_workspace_notes,
    billingNotePlaceholder: t.invoices_workspace_billing_note_placeholder,
    detailSheetDescription: t.invoices_workspace_detail_sheet_description,
    noInvoiceSelected: t.invoices_workspace_no_invoice_selected,
    noInvoiceSelectedDescription: t.invoices_workspace_no_invoice_selected_description,
    invoiceOverview: t.invoices_workspace_invoice_overview,
    invoiceOverviewDescription: t.invoices_workspace_invoice_overview_description,
    previewPdf: t.invoices_workspace_preview_pdf,
    downloadPdf: t.invoices_workspace_download_pdf,
    balanceDue: t.invoices_workspace_balance_due,
    linkedContextDescription: t.invoices_workspace_linked_context_description,
    quotes: t.invoices_workspace_quotes,
    documents: t.invoices_workspace_documents,
    saveInvoice: t.invoices_workspace_save_invoice,
    dunningTitle: t.invoices_workspace_dunning_title,
    dunningDescription: t.invoices_workspace_dunning_description,
    noDunningEvents: t.invoices_workspace_no_dunning_events,
    noDunningEventsDescription: t.invoices_workspace_no_dunning_events_description,
    nextEscalation: t.invoices_workspace_next_escalation,
    completed: t.invoices_workspace_completed,
    balancePrefix: t.invoices_workspace_balance_prefix,
    dunningNote: t.invoices_workspace_dunning_note,
    dunningPlaceholder: t.invoices_workspace_dunning_placeholder,
    noFurtherEscalation: t.invoices_workspace_no_further_escalation,
    lineItems: t.invoices_workspace_line_items,
    lineItemsDescription: t.invoices_workspace_line_items_description,
    noLineItems: t.invoices_workspace_no_line_items,
    noLineItemsDescription: t.invoices_workspace_no_line_items_description,
    quantity: t.invoices_workspace_quantity,
    unit: t.invoices_workspace_unit,
    supportingDocuments: t.invoices_workspace_supporting_documents,
    supportingDocumentsDescription: t.invoices_workspace_supporting_documents_description,
    noSupportingDocuments: t.invoices_workspace_no_supporting_documents,
    noSupportingDocumentsDescription: t.invoices_workspace_no_supporting_documents_description,
    linkedOrderDocument: t.invoices_workspace_linked_order_document,
    openDocuments: t.invoices_workspace_open_documents,
    popupBlocked: t.invoices_workspace_popup_blocked,
    pdfOpenError: t.invoices_workspace_pdf_open_error,
    pdfDownloadError: t.invoices_workspace_pdf_download_error,
    system: t.invoices_workspace_system,
    statsSentWord: t.invoices_workspace_stats_sent_word,
    statsPaidWord: t.invoices_workspace_stats_paid_word,
    pageOf: t.invoices_workspace_page_of,
    linkedOrder: t.invoices_workspace_linked_order,
    ledgerDate: lang === "de" ? "Datum" : "Дата",
    ledgerDirection: lang === "de" ? "Richtung" : "Направление",
    ledgerEntry: lang === "de" ? "Buchung" : "Проводка",
    ledgerCategory: lang === "de" ? "Kategorie" : "Категория",
    ledgerPeriod: lang === "de" ? "Monat" : "Период",
    sendDunning: (level: string) => t.invoices_workspace_send_dunning.replace("{level}", level),
    statuses: {
      draft: t.invoices_workspace_status_draft,
      sent: t.invoices_workspace_status_sent,
      partially_paid: t.invoices_workspace_status_partially_paid,
      paid: t.invoices_workspace_status_paid,
      overdue: t.invoices_workspace_status_overdue,
      cancelled: t.invoices_workspace_status_cancelled,
    },
    types: {
      advance: t.invoices_workspace_type_advance,
      interim: t.invoices_workspace_type_interim,
      final: t.invoices_workspace_type_final,
    },
    dunningLevels: {
      first: t.invoices_workspace_dunning_level_first,
      second: t.invoices_workspace_dunning_level_second,
      collections: t.invoices_workspace_dunning_level_collections,
    },
    directions: {
      income: t.invoices_workspace_direction_income,
      expense: t.invoices_workspace_direction_expense,
    },
  };
  const invoiceStatusLabel = (status: string) => enumLabel(status, text.statuses);
  const invoiceTypeLabel = (invoiceType: string) => enumLabel(invoiceType, text.types);
  const dunningLevelLabel = (level: string) => enumLabel(level, text.dunningLevels);
  const accountingDirectionLabel = (direction: string) => enumLabel(direction, text.directions);
  const canLoadOrderOptions =
    user?.role === "ceo" || user?.role === "patient_manager" || user?.role === "billing";
  const currentYear = String(new Date().getFullYear());
  const canLoadQuoteOptions =
    user?.role === "ceo" ||
    user?.role === "ceo_assistant" ||
    user?.role === "patient_manager" ||
    user?.role === "billing";

  const initialPatientId = searchParams.get("patient") ?? "";
  const initialOrderId = searchParams.get("order") ?? "";
  const initialQuoteId = searchParams.get("quote") ?? "";
  const initialInvoiceId = searchParams.get("invoice") ?? "";
  const initialPage = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS, patientId: initialPatientId, orderId: initialOrderId, quoteId: initialQuoteId });
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [invoicePage, setInvoicePage] = useState(initialPage);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [invoiceTotalPages, setInvoiceTotalPages] = useState(1);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [quotes, setQuotes] = useState<QuoteOption[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(initialInvoiceId);
  const [detail, setDetail] = useState<InvoiceItem | null>(null);
  const [dunningEvents, setDunningEvents] = useState<DunningEvent[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(blankCreateForm(initialQuoteId));
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [statusForm, setStatusForm] = useState<StatusForm>({ status: "draft", dueDate: "", paidAmount: "", notes: "" });
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [dunningBusy, setDunningBusy] = useState(false);
  const [dunningError, setDunningError] = useState<string | null>(null);
  const [dunningForm, setDunningForm] = useState<DunningForm>({ note: "" });
  const [accountingYear, setAccountingYear] = useState(currentYear);
  const [accountingLedger, setAccountingLedger] = useState<AccountingLedgerPayload | null>(null);
  const [accountingBusy, setAccountingBusy] = useState(false);
  const [accountingError, setAccountingError] = useState<string | null>(null);

  const deferredSearch = useDeferredValue(filters.search);
  const effectiveFilters = useMemo(() => ({ ...filters, search: deferredSearch }), [filters, deferredSearch]);

  const syncQuery = (patch: Record<string, string | null | undefined>) => {
    setSearchParams((current) => buildSearchParams(current, patch), { replace: true });
  };

  const filteredOrders = useMemo(() => {
    if (!filters.patientId) return orders;
    return orders.filter((order) => order.patient_id === filters.patientId);
  }, [filters.patientId, orders]);

  const filteredQuotes = useMemo(() => {
    return quotes.filter((quote) => {
      if (filters.patientId && quote.patient_id !== filters.patientId) return false;
      if (filters.orderId && quote.order_id !== filters.orderId) return false;
      return true;
    });
  }, [filters.orderId, filters.patientId, quotes]);
  const selectedFilterPatient = useMemo(
    () => patients.find((patient) => patient.id === filters.patientId) ?? null,
    [patients, filters.patientId],
  );
  const selectedFilterOrder = useMemo(
    () => filteredOrders.find((order) => order.id === filters.orderId) ?? null,
    [filteredOrders, filters.orderId],
  );
  const selectedFilterQuote = useMemo(
    () => filteredQuotes.find((quote) => quote.id === filters.quoteId) ?? null,
    [filteredQuotes, filters.quoteId],
  );

  const selectedCreateQuote = useMemo(() => quotes.find((quote) => quote.id === createForm.quoteId) ?? null, [quotes, createForm.quoteId]);
  const stats = useMemo(() => {
    const paid = invoices.filter((invoice) => invoice.status === "paid").length;
    const sent = invoices.filter((invoice) => invoice.status === "sent").length;
    const gross = invoices.reduce((sum, invoice) => sum + Number(invoice.total_gross ?? 0), 0);
    const balance = invoices.reduce((sum, invoice) => sum + Number(invoice.balance_due ?? 0), 0);
    return { total: invoiceTotal, paid, sent, gross, balance };
  }, [invoiceTotal, invoices]);
  const invoiceTableColumns: ColumnDef<InvoiceItem>[] = [
      {
        id: "invoice_number",
        label: t.invoices_number,
        accessor: (row) => row.invoice_number,
        sortable: true,
        required: true,
        width: 180,
        render: (row) => (
          <span className="font-mono text-xs font-semibold tracking-[0.14em] text-muted-foreground">
            {row.invoice_number}
          </span>
        ),
      },
      {
        id: "issued_at",
        label: t.invoices_issued_at,
        accessor: (row) => row.issued_at,
        sortable: true,
        width: 170,
        render: (row) => formatDateTime(row.issued_at, locale, t.common_not_set),
      },
      {
        id: "patient_name",
        label: t.invoices_patient,
        accessor: (row) => row.patient_name,
        sortable: true,
        required: true,
        width: 220,
        render: (row) => (
          <div>
            <div className="text-sm font-medium text-foreground">{row.patient_name}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{row.patient_pid}</div>
          </div>
        ),
      },
      {
        id: "order_number",
        label: t.orders_title,
        accessor: (row) => row.order_number,
        sortable: true,
        width: 180,
      },
      {
        id: "quote_number",
        label: t.contracts_type,
        accessor: (row) => row.quote_number ?? "",
        sortable: true,
        width: 160,
        render: (row) => row.quote_number ?? t.common_not_set,
      },
      {
        id: "invoice_type",
        label: t.invoices_type,
        accessor: (row) => row.invoice_type,
        sortable: true,
        width: 140,
        render: (row) => (
          <StatusBadge tone={invoiceTypeTone(row.invoice_type)}>
            {invoiceTypeLabel(row.invoice_type)}
          </StatusBadge>
        ),
      },
      {
        id: "status",
        label: t.invoices_status,
        accessor: (row) => row.status,
        sortable: true,
        width: 150,
        render: (row) => (
          <StatusBadge tone={statusBadgeClass(row.status)}>
            {invoiceStatusLabel(row.status)}
          </StatusBadge>
        ),
      },
      {
        id: "due_date",
        label: t.invoices_due_at,
        accessor: (row) => row.due_date ?? "",
        sortable: true,
        width: 150,
        render: (row) => formatDate(row.due_date, locale, t.common_not_set),
      },
      {
        id: "paid_amount",
        label: t.invoices_paid,
        accessor: (row) => Number(row.paid_amount ?? 0),
        sortable: true,
        width: 140,
        render: (row) => (
          <span className="block text-right font-medium tabular-nums text-foreground">
            {formatMoney(row.paid_amount)}
          </span>
        ),
      },
      {
        id: "balance_due",
        label: text.balance,
        accessor: (row) => Number(row.balance_due ?? 0),
        sortable: true,
        width: 140,
        render: (row) => (
          <span className="block text-right font-medium tabular-nums text-foreground">
            {formatMoney(row.balance_due)}
          </span>
        ),
      },
      {
        id: "total_gross",
        label: t.invoices_total,
        accessor: (row) => Number(row.total_gross ?? 0),
        sortable: true,
        width: 150,
        render: (row) => (
          <span className="block text-right font-semibold tabular-nums text-foreground">
            {formatMoney(row.total_gross)}
          </span>
        ),
      },
  ];
  const accountingTableColumns: ColumnDef<AccountingEntry>[] = [
    {
      id: "entry_date",
      label: text.ledgerDate,
      accessor: (row) => row.entry_date,
      sortable: true,
      required: true,
      width: 130,
      render: (row) => formatDate(row.entry_date, locale, t.common_not_set),
    },
    {
      id: "direction",
      label: text.ledgerDirection,
      accessor: (row) => row.direction,
      sortable: true,
      width: 130,
      render: (row) => (
        <StatusBadge tone={row.direction === "income" ? "success" : "error"}>
          {accountingDirectionLabel(row.direction)}
        </StatusBadge>
      ),
    },
    {
      id: "invoice_number",
      label: t.invoices_number,
      accessor: (row) => row.invoice_number ?? row.external_invoice_number ?? "",
      sortable: true,
      width: 170,
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.invoice_number ?? row.external_invoice_number ?? t.common_not_set}
        </span>
      ),
    },
    {
      id: "description",
      label: text.ledgerEntry,
      accessor: (row) => row.description,
      sortable: true,
      width: 260,
      render: (row) => (
        <span className="block truncate text-sm text-foreground">{row.description}</span>
      ),
    },
    {
      id: "category",
      label: text.ledgerCategory,
      accessor: (row) => row.category,
      sortable: true,
      width: 150,
    },
    {
      id: "order_number",
      label: t.orders_title,
      accessor: (row) => row.order_number ?? "",
      sortable: true,
      width: 160,
      render: (row) => row.order_number ?? text.noOrder,
    },
    {
      id: "patient_name",
      label: t.invoices_patient,
      accessor: (row) => row.patient_name ?? "",
      sortable: true,
      width: 210,
      render: (row) =>
        row.patient_name ? `${row.patient_name}${row.patient_pid ? ` (${row.patient_pid})` : ""}` : text.noPatient,
    },
    {
      id: "amount_net",
      label: text.net,
      accessor: (row) => Number(row.amount_net ?? 0),
      sortable: true,
      width: 130,
      render: (row) => (
        <span className="block text-right font-medium tabular-nums text-foreground">
          {formatMoney(row.amount_net)}
        </span>
      ),
    },
    {
      id: "amount_vat",
      label: t.invoices_vat,
      accessor: (row) => Number(row.amount_vat ?? 0),
      sortable: true,
      width: 130,
      render: (row) => (
        <span className="block text-right font-medium tabular-nums text-foreground">
          {formatMoney(row.amount_vat)}
        </span>
      ),
    },
    {
      id: "amount_gross",
      label: text.gross,
      accessor: (row) => Number(row.amount_gross ?? 0),
      sortable: true,
      width: 140,
      render: (row) => (
        <span className="block text-right font-semibold tabular-nums text-foreground">
          {formatMoney(row.amount_gross)}
        </span>
      ),
    },
  ];
  const accountingMonthlyTableColumns: ColumnDef<AccountingMonthlyItem>[] = [
    {
      id: "period",
      label: text.ledgerPeriod,
      accessor: (row) => row.period,
      sortable: true,
      required: true,
      width: 160,
      render: (row) => <span className="font-medium text-foreground">{row.period}</span>,
    },
    {
      id: "income_gross",
      label: text.income,
      accessor: (row) => Number(row.income_gross ?? 0),
      sortable: true,
      width: 170,
      render: (row) => (
        <span className="block text-right font-medium tabular-nums text-foreground">
          {formatMoney(row.income_gross)}
        </span>
      ),
    },
    {
      id: "expense_gross",
      label: text.expense,
      accessor: (row) => Number(row.expense_gross ?? 0),
      sortable: true,
      width: 170,
      render: (row) => (
        <span className="block text-right font-medium tabular-nums text-foreground">
          {formatMoney(row.expense_gross)}
        </span>
      ),
    },
    {
      id: "net_surplus",
      label: text.surplus,
      accessor: (row) => Number(row.net_surplus ?? 0),
      sortable: true,
      width: 180,
      render: (row) => {
        const value = Number(row.net_surplus ?? 0);
        return (
          <span
            className={cn(
              "block text-right font-semibold tabular-nums",
              value > 0 ? "text-emerald-700" : value < 0 ? "text-rose-700" : "text-foreground",
            )}
          >
            {formatMoney(row.net_surplus)}
          </span>
        );
      },
    },
  ];
  const nextDunning = useMemo(() => nextDunningLevel(dunningEvents), [dunningEvents]);
  const accountingSummary = accountingLedger?.summary ?? EMPTY_ACCOUNTING_SUMMARY;
  const accountingEntries = Array.isArray(accountingLedger?.entries) ? accountingLedger.entries : [];
  const accountingMonthly = Array.isArray(accountingLedger?.monthly) ? accountingLedger.monthly : [];

  useEffect(() => {
    let ignore = false;
    async function loadOptions() {
      try {
        const {
          patients: patientsResult,
          orders: ordersResult,
          quotes: quotesResult,
        } = await fetchInvoiceLookups(canLoadOrderOptions, canLoadQuoteOptions);
        if (ignore) return;
        setPatients(patientsResult);
        setOrders(ordersResult);
        setQuotes(quotesResult);
        setOptionsError(null);
      } catch (error) {
        if (!ignore) setOptionsError(error instanceof Error ? error.message : t.common_error);
      }
    }
    void loadOptions();
    return () => {
      ignore = true;
    };
  }, [canLoadOrderOptions, canLoadQuoteOptions, t.common_error]);

  useEffect(() => {
    let ignore = false;
    async function loadInvoices() {
      setListBusy(true);
      try {
        const data = await fetchInvoices(buildInvoicesPath(effectiveFilters, invoicePage));
        if (!ignore) {
          setInvoices(Array.isArray(data.items) ? data.items : []);
          setInvoiceTotal(typeof data.total === "number" ? data.total : 0);
          setInvoiceTotalPages(
            typeof data.total_pages === "number" && data.total_pages > 0
              ? data.total_pages
              : 1,
          );
          if (typeof data.page === "number" && data.page > 0) {
            setInvoicePage(data.page);
          }
          setListError(null);
        }
      } catch (error) {
        if (!ignore) setListError(error instanceof Error ? error.message : t.common_error);
      } finally {
        if (!ignore) setListBusy(false);
      }
    }
    void loadInvoices();
    return () => {
      ignore = true;
    };
  }, [effectiveFilters, invoicePage, reloadToken, t.common_error]);

  useEffect(() => {
    setSearchParams(
      (current) =>
        buildSearchParams(current, {
          page: invoicePage > 1 ? String(invoicePage) : null,
        }),
      { replace: true },
    );
  }, [invoicePage, setSearchParams]);

  useEffect(() => {
    if (!selectedInvoiceId) {
      setDetail(null);
      setDunningEvents([]);
      setDetailError(null);
      return;
    }
    let ignore = false;
    async function loadDetail() {
      setDetailBusy(true);
      try {
        const { invoice: data, dunning } =
          await fetchInvoiceWorkspace(selectedInvoiceId);
        if (!ignore) {
          setDetail(data);
          setDunningEvents(dunning);
          setStatusForm(invoiceToStatusForm(data));
          setDunningForm({ note: "" });
          setDunningError(null);
          setDetailError(null);
        }
      } catch (error) {
        if (!ignore) setDetailError(error instanceof Error ? error.message : t.common_error);
      } finally {
        if (!ignore) setDetailBusy(false);
      }
    }
    void loadDetail();
    return () => {
      ignore = true;
    };
  }, [selectedInvoiceId, reloadToken, t.common_error]);

  useEffect(() => {
    if (!access.canAccounting) {
      setAccountingLedger(null);
      setAccountingError(null);
      setAccountingBusy(false);
      return;
    }
    let ignore = false;
    async function loadAccountingLedger() {
      setAccountingBusy(true);
      try {
        const data = await fetchAccountingLedger(accountingYear);
        if (!ignore) {
          setAccountingLedger(data);
          setAccountingError(null);
        }
      } catch (error) {
        if (!ignore) {
          setAccountingError(
            error instanceof Error ? error.message : t.common_error,
          );
        }
      } finally {
        if (!ignore) setAccountingBusy(false);
      }
    }
    void loadAccountingLedger();
    return () => {
      ignore = true;
    };
  }, [access.canAccounting, accountingYear, reloadToken, t.common_error]);

  async function handleCreateInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm.quoteId) {
      setCreateError(text.chooseQuote);
      return;
    }
    setCreateBusy(true);
    try {
      const created = await createInvoice(createForm.quoteId, {
        invoice_type: createForm.invoiceType,
        due_date: createForm.dueDate || null,
        notes: createForm.notes.trim() || null,
      });
      setCreateOpen(false);
      setCreateForm(blankCreateForm(filters.quoteId));
      setCreateError(null);
      setReloadToken((current) => current + 1);
      setSelectedInvoiceId(created.id);
      syncQuery({ invoice: created.id });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleSaveStatus() {
    if (!selectedInvoiceId) return;
    setStatusBusy(true);
    try {
      await updateInvoiceStatus(selectedInvoiceId, {
        status: statusForm.status,
        due_date: statusForm.dueDate || null,
        paid_amount: statusForm.paidAmount.trim()
          ? Number(statusForm.paidAmount)
          : null,
        notes: statusForm.notes.trim() || null,
      });
      setStatusError(null);
      setReloadToken((current) => current + 1);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleCreateDunning() {
    if (!selectedInvoiceId || !nextDunning) return;
    setDunningBusy(true);
    try {
      const created = await createDunningEvent(selectedInvoiceId, {
        level: nextDunning,
        note: dunningForm.note.trim() || null,
      });
      setDunningEvents((current) => [...current, created]);
      setDunningForm({ note: "" });
      setDunningError(null);
      setReloadToken((current) => current + 1);
    } catch (error) {
      setDunningError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setDunningBusy(false);
    }
  }

  function openInvoice(invoiceId: string) {
    setSelectedInvoiceId(invoiceId);
    syncQuery({ invoice: invoiceId });
  }

  if (!access.canView) {
    return (
      <div className="rounded-xl">
        <ShellBanner tone="warning" withIcon>
          {text.accessDenied}
        </ShellBanner>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          title={t.invoices_title}
          description={text.workspaceDescription}
          actions={(
            <>
              <Button
                type="button"
                variant="outline"
                className="rounded-lg"
                onClick={() => setReloadToken((current) => current + 1)}
              >
                <RefreshCw className="mr-2 size-4" />
                {text.refresh}
              </Button>
              {access.canCreate ? (
                <Button
                  type="button"
                  className="h-9 rounded-lg px-3.5"
                  onClick={() => {
                    setCreateForm(blankCreateForm(filters.quoteId));
                    setCreateError(null);
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="mr-2 size-4" />
                  {text.newInvoice}
                </Button>
              ) : null}
            </>
          )}
        />

        <div className="flex flex-wrap gap-6 rounded-xl border border-border bg-card px-4 py-3">
          <AdminInlineMetric
            icon={Wallet}
            label={t.invoices_title}
            value={String(stats.total)}
            description={`${stats.sent} ${text.statsSentWord} / ${stats.paid} ${text.statsPaidWord}`}
            tone="sky"
          />
          <AdminInlineMetric
            icon={CalendarClock}
            label={text.grossTotal}
            value={formatMoney(stats.gross)}
            description={text.grossTotalDescription}
            tone="emerald"
          />
          <AdminInlineMetric
            icon={Wallet}
            label={text.openBalance}
            value={formatMoney(stats.balance)}
            description={text.openBalanceDescription}
            tone="amber"
          />
          <AdminInlineMetric
            icon={Plus}
            label={text.quotesReady}
            value={String(filteredQuotes.length)}
            description={text.quotesReadyDescription}
            tone="slate"
          />
        </div>

        {access.canAccounting ? (
          <SectionCard
            title={text.accountingTitle}
            description={text.accountingDescription}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min="2020"
                  max="2100"
                  value={accountingYear}
                  onChange={(event) => setAccountingYear(event.target.value || currentYear)}
                  className={cn(shellInputClassName, "w-28")}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-lg"
                  onClick={() => setReloadToken((current) => current + 1)}
                >
                  <RefreshCw className="mr-2 size-4" />
                  {text.refreshLedger}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-lg"
                  onClick={() =>
                    void downloadAccountingLedgerExport(accountingYear).catch((error) =>
                      setAccountingError(
                        error instanceof Error ? error.message : t.common_error,
                      ),
                    )
                  }
                >
                  <Download className="mr-2 size-4" />
                  {text.exportCsv}
                </Button>
              </div>
            }
          >
            {accountingBusy ? (
              <LoadingState label={t.common_loading} />
            ) : accountingError ? (
              <ShellBanner tone="error">{accountingError}</ShellBanner>
            ) : accountingLedger ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <MiniMetric
                    label={text.cashIncome}
                    value={formatMoney(accountingSummary.income_gross)}
                  />
                  <MiniMetric
                    label={text.cashExpense}
                    value={formatMoney(accountingSummary.expense_gross)}
                  />
                  <MiniMetric
                    label={text.euerSurplus}
                    value={formatMoney(accountingSummary.net_surplus)}
                  />
                  <MiniMetric
                    label={text.costPassthroughRevenue}
                    value={formatMoney(accountingSummary.cost_passthrough_revenue_gross)}
                  />
                </div>
                <DataTable
                  rows={accountingEntries}
                  columns={accountingTableColumns}
                  rowId={(row) => row.id}
                  density="compact"
                  rowAccent={(row) => (row.direction === "income" ? "bg-emerald-500" : "bg-rose-500")}
                  emptyState={
                    <EmptyState
                      title={text.noAccountingEntries}
                      description={text.noAccountingEntriesDescription}
                    />
                  }
                />
                <div className="space-y-3">
                  <div className={tokens.text.eyebrow}>{text.monthlyEuer}</div>
                  <DataTable
                    rows={accountingMonthly}
                    columns={accountingMonthlyTableColumns}
                    rowId={(row) => row.period}
                    density="compact"
                    rowAccent={(row) => {
                      const value = Number(row.net_surplus ?? 0);
                      if (value > 0) return "bg-emerald-500";
                      if (value < 0) return "bg-rose-500";
                      return "bg-slate-300";
                    }}
                    emptyState={
                      <EmptyState
                        title={text.monthlyEuer}
                        description={text.noCashMovement.replace("{year}", accountingYear)}
                      />
                    }
                  />
                </div>
              </div>
            ) : null}
          </SectionCard>
        ) : null}

        {optionsError ? <ShellBanner tone="error">{optionsError}</ShellBanner> : null}

        <AdminTableCard
          title={titleWithDot(t.invoices_title)}
          description={t.invoices_subtitle}
          count={invoiceTotal}
        >
          <div className="space-y-4 border-b border-border px-4 py-4">
            <AdminToolbar className="gap-2">
              <div className="relative min-w-[260px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filters.search}
                  onChange={(event) => startTransition(() => {
                    setFilters((current) => ({ ...current, search: event.target.value }));
                    setInvoicePage(1);
                  })}
                  className={cn(shellInputClassName, "pl-9")}
                  placeholder={text.searchPlaceholder}
                />
              </div>
              <div className="w-[220px] min-w-[220px]">
                <ShadSelect
                  value={filters.patientId || "__all__"}
                  onValueChange={(value) => {
                    const patientId = value && value !== "__all__" ? value : "";
                    setFilters((current) => ({
                      ...current,
                      patientId,
                      orderId:
                        current.orderId &&
                        orders.some((order) => order.id === current.orderId && order.patient_id === patientId)
                          ? current.orderId
                          : "",
                      quoteId:
                        current.quoteId &&
                        quotes.some((quote) => quote.id === current.quoteId && quote.patient_id === patientId)
                          ? current.quoteId
                          : "",
                    }));
                    setInvoicePage(1);
                    syncQuery({ patient: patientId || null, order: null, quote: null });
                  }}
                >
                  <SelectTrigger className={cn(selectClassName, "w-[220px] min-w-[220px]")}>
                    <SelectValue>
                      {selectedFilterPatient
                        ? `${selectedFilterPatient.patient_id} | ${[
                            selectedFilterPatient.first_name,
                            selectedFilterPatient.last_name,
                          ]
                            .filter(Boolean)
                            .join(" ")}`
                        : t.providers_all}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t.providers_all}</SelectItem>
                    {patients.map((patient) => (
                      <SelectItem key={patient.id} value={patient.id}>
                        {`${patient.patient_id} | ${[patient.first_name, patient.last_name].filter(Boolean).join(" ")}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
              </div>
              <div className="w-[220px] min-w-[220px]">
                <ShadSelect
                  value={filters.orderId || "__all__"}
                  onValueChange={(value) => {
                    const orderId = value && value !== "__all__" ? value : "";
                    setFilters((current) => ({
                      ...current,
                      orderId,
                      quoteId:
                        current.quoteId &&
                        quotes.some((quote) => quote.id === current.quoteId && quote.order_id === orderId)
                          ? current.quoteId
                          : "",
                    }));
                    setInvoicePage(1);
                    syncQuery({ order: orderId || null, quote: null });
                  }}
                >
                  <SelectTrigger className={cn(selectClassName, "w-[220px] min-w-[220px]")}>
                    <SelectValue>
                      {selectedFilterOrder
                        ? `${selectedFilterOrder.order_number} | ${selectedFilterOrder.patient_pid} | ${selectedFilterOrder.patient_name}`
                        : text.allOrders}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{text.allOrders}</SelectItem>
                    {filteredOrders.map((order) => (
                      <SelectItem key={order.id} value={order.id}>
                        {`${order.order_number} | ${order.patient_pid} | ${order.patient_name}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
              </div>
              <div className="w-[220px] min-w-[220px]">
                <ShadSelect
                  value={filters.quoteId || "__all__"}
                  onValueChange={(value) => {
                    const quoteId = value && value !== "__all__" ? value : "";
                    setFilters((current) => ({ ...current, quoteId }));
                    setInvoicePage(1);
                    syncQuery({ quote: quoteId || null });
                  }}
                >
                  <SelectTrigger className={cn(selectClassName, "w-[220px] min-w-[220px]")}>
                    <SelectValue>
                      {selectedFilterQuote
                        ? `${selectedFilterQuote.quote_number} | ${selectedFilterQuote.order_number} | ${selectedFilterQuote.patient_pid}`
                        : text.allQuotes}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{text.allQuotes}</SelectItem>
                    {filteredQuotes.map((quote) => (
                      <SelectItem key={quote.id} value={quote.id}>
                        {`${quote.quote_number} | ${quote.order_number} | ${quote.patient_pid}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
              </div>
              <div className="w-[180px] min-w-[180px]">
                <ShadSelect
                  value={filters.status || "__all__"}
                  onValueChange={(value) => {
                    setFilters((current) => ({
                      ...current,
                      status: value && value !== "__all__" ? value : "",
                    }));
                    setInvoicePage(1);
                  }}
                >
                  <SelectTrigger className={cn(selectClassName, "w-[180px] min-w-[180px]")}>
                    <SelectValue>
                      {filters.status ? invoiceStatusLabel(filters.status) : t.providers_all}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t.providers_all}</SelectItem>
                    {INVOICE_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {invoiceStatusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
              </div>
              <div className="w-[180px] min-w-[180px]">
                <ShadSelect
                  value={filters.invoiceType || "__all__"}
                  onValueChange={(value) => {
                    setFilters((current) => ({
                      ...current,
                      invoiceType: value && value !== "__all__" ? value : "",
                    }));
                    setInvoicePage(1);
                  }}
                >
                  <SelectTrigger className={cn(selectClassName, "w-[180px] min-w-[180px]")}>
                    <SelectValue>
                      {filters.invoiceType
                        ? invoiceTypeLabel(filters.invoiceType)
                        : t.providers_all}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t.providers_all}</SelectItem>
                    {INVOICE_TYPES.map((invoiceType) => (
                      <SelectItem key={invoiceType} value={invoiceType}>
                        {invoiceTypeLabel(invoiceType)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg px-3.5"
                onClick={() => {
                  setFilters({
                    ...DEFAULT_FILTERS,
                    patientId: searchParams.get("patient") ?? "",
                    orderId: searchParams.get("order") ?? "",
                    quoteId: searchParams.get("quote") ?? "",
                  });
                  setInvoicePage(1);
                }}
              >
                {t.access_reset}
              </Button>
            </AdminToolbar>
          </div>

          <div className="space-y-3 p-4">
            {listError ? <ShellBanner tone="error">{listError}</ShellBanner> : null}
            <DataTable
              rows={invoices}
              columns={invoiceTableColumns}
              rowId={(row) => row.id}
              density="compact"
              loading={listBusy}
              activeRowId={selectedInvoiceId || null}
              onRowClick={(row) => openInvoice(row.id)}
              rowAccent={(row) => {
                if (row.id === selectedInvoiceId) return "bg-sky-500";
                if (row.status === "overdue") return "bg-rose-500";
                if (row.status === "paid") return "bg-emerald-500";
                return null;
              }}
              emptyState={
                <EmptyState
                  title={t.common_not_set}
                  description={text.emptyInvoicesDescription}
                  action={
                    access.canCreate ? (
                      <Button type="button" onClick={() => setCreateOpen(true)}>
                        <Plus className="mr-2 size-4" />
                        {t.invoices_new}
                      </Button>
                    ) : null
                  }
                />
              }
              footer={`${text.pageLabel} ${invoicePage} ${text.pageOf} ${invoiceTotalPages} | ${invoiceTotal} ${text.invoiceCount}`}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-lg"
                  disabled={listBusy || invoicePage <= 1}
                  onClick={() => setInvoicePage((current) => Math.max(1, current - 1))}
                >
                  {text.previous}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-lg"
                  disabled={listBusy || invoicePage >= invoiceTotalPages}
                  onClick={() =>
                    setInvoicePage((current) => Math.min(invoiceTotalPages, current + 1))
                  }
                >
                  {text.next}
                </Button>
              </div>
            </div>
          </div>
        </AdminTableCard>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
          <form className="flex h-full flex-col" onSubmit={handleCreateInvoice}>
            <AdminSheetScaffold
              title={t.invoices_new}
              description={text.createInvoiceDescription}
              footer={(
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.invoices_new}
                  submitting={createBusy}
                  submitDisabled={!createForm.quoteId}
                  onCancel={() => setCreateOpen(false)}
                />
              )}
            >
              {createError ? <ShellBanner tone="error">{createError}</ShellBanner> : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.contracts_type} className="sm:col-span-2">
                  <ShadSelect
                    value={createForm.quoteId || "__empty__"}
                    onValueChange={(value) =>
                      setCreateForm((current) => ({
                        ...current,
                        quoteId: value && value !== "__empty__" ? value : "",
                      }))
                    }
                  >
                    <SelectTrigger className={selectClassName}>
                      <SelectValue>
                        {selectedCreateQuote
                          ? `${selectedCreateQuote.quote_number} | ${selectedCreateQuote.order_number} | ${selectedCreateQuote.patient_pid}`
                          : text.chooseQuote}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__empty__">{text.chooseQuote}</SelectItem>
                      {filteredQuotes.map((quote) => (
                        <SelectItem key={quote.id} value={quote.id}>
                          {`${quote.quote_number} | ${quote.order_number} | ${quote.patient_pid}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </Field>
                <Field label={t.invoices_type}>
                  <ShadSelect
                    value={createForm.invoiceType}
                    onValueChange={(value) =>
                      setCreateForm((current) => ({ ...current, invoiceType: value as InvoiceType }))
                    }
                  >
                    <SelectTrigger className={selectClassName}>
                      <SelectValue>{invoiceTypeLabel(createForm.invoiceType)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {INVOICE_TYPES.map((invoiceType) => (
                        <SelectItem key={invoiceType} value={invoiceType}>
                          {invoiceTypeLabel(invoiceType)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </Field>
                <Field label={t.invoices_due_at}>
                  <Input
                    type="date"
                    className={shellInputClassName}
                    value={createForm.dueDate}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, dueDate: event.target.value }))
                    }
                  />
                </Field>
                <Field label={text.selectedQuoteSnapshot} className="sm:col-span-2">
                  <div className={cn("rounded-xl px-3 py-2 text-sm text-foreground", tokens.surface.mutedCard)}>
                    {selectedCreateQuote
                      ? `${selectedCreateQuote.quote_number} | ${selectedCreateQuote.order_number} | ${formatMoney(selectedCreateQuote.total_gross)}`
                      : text.chooseQuote}
                  </div>
                </Field>
                <Field label={text.notes} className="sm:col-span-2">
                  <textarea
                    className={textareaClassName}
                    value={createForm.notes}
                    onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder={text.billingNotePlaceholder}
                  />
                </Field>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={Boolean(selectedInvoiceId)} onOpenChange={(open) => {
        if (!open) {
          setSelectedInvoiceId("");
          setDetail(null);
          setDunningEvents([]);
          setDunningError(null);
          setDetailError(null);
          syncQuery({ invoice: null });
        }
      }}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <AdminSheetScaffold
            title={detail ? `${detail.invoice_number} / ${detail.patient_name}` : t.invoices_title}
            description={text.detailSheetDescription}
          >
            {detailBusy ? <LoadingState label={t.common_loading} /> : detailError ? <ShellBanner tone="error">{detailError}</ShellBanner> : !detail ? <EmptyState title={text.noInvoiceSelected} description={text.noInvoiceSelectedDescription} /> : (
              <div className="space-y-6">
                <SectionCard
                  title={text.invoiceOverview}
                  description={text.invoiceOverviewDescription}
                  action={
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-lg"
                        onClick={() =>
                          void openInvoicePdfPreview(detail.id, text.popupBlocked).catch((error) =>
                            setDetailError(error instanceof Error ? error.message : text.pdfOpenError),
                          )
                        }
                      >
                        {text.previewPdf}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-lg"
                        onClick={() =>
                          void downloadInvoicePdf(detail.id, `${detail.invoice_number}.pdf`).catch((error) =>
                            setDetailError(error instanceof Error ? error.message : text.pdfDownloadError),
                          )
                        }
                      >
                        <Download className="size-4" />
                        {text.downloadPdf}
                      </Button>
                      <StatusBadge tone={statusBadgeClass(detail.status)}>
                        {invoiceStatusLabel(detail.status)}
                      </StatusBadge>
                      <StatusBadge tone={invoiceTypeTone(detail.invoice_type)}>
                        {invoiceTypeLabel(detail.invoice_type)}
                      </StatusBadge>
                    </div>
                  }
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <DetailField label={t.invoices_patient} value={`${detail.patient_name} (${detail.patient_pid})`} />
                    <DetailField label={t.orders_title} value={detail.order_number} />
                    <DetailField label={t.contracts_type} value={detail.quote_number ?? t.common_not_set} />
                    <DetailField label={t.invoices_issued_at} value={formatDateTime(detail.issued_at, locale, t.common_not_set)} />
                    <DetailField label={t.invoices_due_at} value={formatDate(detail.due_date, locale, t.common_not_set)} />
                    <DetailField label={t.invoices_paid_at} value={formatDateTime(detail.paid_at, locale, t.common_not_set)} />
                    <DetailField label={text.grossTotal} value={formatMoney(detail.total_gross)} />
                    <DetailField label={t.invoices_paid} value={formatMoney(detail.paid_amount)} />
                    <DetailField label={text.balanceDue} value={formatMoney(detail.balance_due)} />
                    <DetailField label={text.notes} value={detail.notes || t.common_not_set} />
                  </div>
                </SectionCard>

                <SectionCard title={t.providers_linked_patients} description={text.linkedContextDescription}>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="rounded-lg" onClick={() => staffGo(`/patients?patient=${detail.patient_id}`)}>{t.invoices_patient}</Button>
                    <Button type="button" variant="outline" className="rounded-lg" onClick={() => staffGo(`/orders?order=${detail.order_id}&patient=${detail.patient_id}`)}>{text.linkedOrder}</Button>
                    <Button type="button" variant="outline" className="rounded-lg" onClick={() => staffGo(`/contracts?quote=${detail.quote_id ?? ""}&order=${detail.order_id}&patient=${detail.patient_id}&tab=quotes`)}>{text.quotes}</Button>
                    <Button type="button" variant="outline" className="rounded-lg" onClick={() => staffGo(`/documents?order=${detail.order_id}&patient=${detail.patient_id}`)}>{text.documents}</Button>
                  </div>
                </SectionCard>

                <SectionCard title={t.invoices_status} description={t.invoices_subtitle}>
                  {statusError ? <ShellBanner tone="error">{statusError}</ShellBanner> : null}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={t.users_status}>
                      <select value={statusForm.status} onChange={(event) => setStatusForm((current) => ({ ...current, status: event.target.value as InvoiceStatus }))} className={selectClassName} disabled={!access.canManage}>
                        {INVOICE_STATUSES.map((status) => <option key={status} value={status}>{invoiceStatusLabel(status)}</option>)}
                      </select>
                    </Field>
                    <Field label={t.invoices_due_at}>
                      <Input type="date" className={shellInputClassName} value={statusForm.dueDate} onChange={(event) => setStatusForm((current) => ({ ...current, dueDate: event.target.value }))} disabled={!access.canManage} />
                    </Field>
                    <Field label={t.invoices_paid}>
                      <Input type="number" step="0.01" min="0" className={shellInputClassName} value={statusForm.paidAmount} onChange={(event) => setStatusForm((current) => ({ ...current, paidAmount: event.target.value }))} disabled={!access.canManage} />
                    </Field>
                    <Field label={text.notes} className="sm:col-span-2">
                      <textarea className={textareaClassName} value={statusForm.notes} onChange={(event) => setStatusForm((current) => ({ ...current, notes: event.target.value }))} disabled={!access.canManage} />
                    </Field>
                  </div>
                  <SheetActionsFooter>
                    <Button type="button" className="h-9 rounded-lg" onClick={() => void handleSaveStatus()} disabled={statusBusy || !access.canManage}>
                      {statusBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                      {text.saveInvoice}
                    </Button>
                  </SheetActionsFooter>
                </SectionCard>

                <SectionCard title={text.dunningTitle} description={text.dunningDescription}>
                  {dunningError ? <ShellBanner tone="error">{dunningError}</ShellBanner> : null}
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                    <div className="space-y-3">
                      {dunningEvents.length === 0 ? (
                        <EmptyState title={text.noDunningEvents} description={text.noDunningEventsDescription} />
                      ) : (
                        dunningEvents.map((event) => (
                          <div key={event.id} className={cn("rounded-xl p-4", tokens.surface.mutedCard)}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className={tokens.text.sectionTitle}>{dunningLevelLabel(event.level)}</div>
                                <div className={cn("mt-1", tokens.text.muted)}>{`${formatDateTime(event.sent_at, locale, t.common_not_set)} | ${event.created_by_name ?? text.system}`}</div>
                              </div>
                              <StatusBadge tone="error">{formatMoney(event.balance_due)}</StatusBadge>
                            </div>
                            {event.note ? <div className="mt-3 text-sm text-muted-foreground">{event.note}</div> : null}
                          </div>
                        ))
                      )}
                    </div>
                    <div className={cn("rounded-xl p-4", tokens.surface.mutedCard)}>
                      <div className={tokens.text.eyebrow}>{text.nextEscalation}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge tone={nextDunning ? dunningLevelTone(nextDunning) : "neutral"}>
                          {nextDunning ? dunningLevelLabel(nextDunning) : text.completed}
                        </StatusBadge>
                        <span className="text-sm text-muted-foreground">{`${text.balancePrefix} ${formatMoney(detail.balance_due)}`}</span>
                      </div>
                      <div className="mt-4 space-y-3">
                        <Field label={text.dunningNote}>
                          <textarea className={textareaClassName} value={dunningForm.note} onChange={(event) => setDunningForm({ note: event.target.value })} disabled={!access.canManage || !nextDunning} placeholder={text.dunningPlaceholder} />
                        </Field>
                        <Button type="button" className="w-full" onClick={() => void handleCreateDunning()} disabled={dunningBusy || !access.canManage || !nextDunning}>
                          {dunningBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                          {nextDunning ? text.sendDunning(dunningLevelLabel(nextDunning)) : text.noFurtherEscalation}
                        </Button>
                      </div>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title={text.lineItems} description={text.lineItemsDescription}>
                  {!detail.line_items || detail.line_items.length === 0 ? <EmptyState title={text.noLineItems} description={text.noLineItemsDescription} /> : (
                    <div className="space-y-3">
                      {detail.line_items.map((line, index) => (
                        <div key={`${line.description}-${index}`} className={cn("rounded-xl p-4", tokens.surface.mutedCard)}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className={tokens.text.sectionTitle}>{line.description}</h3>
                              <p className={cn("mt-1", tokens.text.muted)}>{`${text.quantity} ${line.quantity} | ${text.unit} ${formatMoney(line.unit_price)}`}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <StatusBadge tone="neutral">{`${t.invoices_vat} ${line.vat_rate}%`}</StatusBadge>
                              {line.is_cost_passthrough ? (
                                <StatusBadge tone="warning">{t.orders_cost_pass_through_badge}</StatusBadge>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-3">
                            <MiniMetric label={text.net} value={formatMoney(line.line_net)} />
                            <MiniMetric label={t.invoices_vat} value={formatMoney(line.line_vat)} />
                            <MiniMetric label={text.gross} value={formatMoney(line.line_gross)} />
                          </div>
                          {line.notes ? <div className="mt-3 text-sm text-muted-foreground">{line.notes}</div> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard
                  title={text.supportingDocuments}
                  description={text.supportingDocumentsDescription}
                >
                  {!detail.supporting_documents || detail.supporting_documents.length === 0 ? (
                    <EmptyState
                      title={text.noSupportingDocuments}
                      description={text.noSupportingDocumentsDescription}
                    />
                  ) : (
                    <div className="space-y-3">
                      {detail.supporting_documents.map((document) => (
                        <div
                          key={document.id}
                          className={cn("rounded-xl p-4", tokens.surface.mutedCard)}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h3 className={tokens.text.sectionTitle}>
                                {document.auto_name || document.original_filename || document.id}
                              </h3>
                              <p className={cn("mt-1", tokens.text.muted)}>
                                {[document.art, document.category, document.original_filename]
                                  .filter(Boolean)
                                  .join(" | ") || text.linkedOrderDocument}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-lg"
                              onClick={() =>
                                staffGo(
                                  `/documents?order=${detail.order_id}&patient=${detail.patient_id}`,
                                )
                              }
                            >
                              {text.openDocuments}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>
            )}
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function InvoicesPage() {
  const { user } = useAuth();

  if (user?.role === "patient") {
    return <PatientInvoicesPage />;
  }

  return <StaffInvoicesPage />;
}

function SectionCard({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
            <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
            <span>{title}</span>
          </h2>
          {description ? <p className={tokens.text.muted}>{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
      <span>{title}</span>
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={cn("rounded-xl p-4", tokens.surface.mutedCard)}>
      <div className={tokens.text.eyebrow}>{label}</div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className={cn("rounded-xl p-3", tokens.surface.mutedCard)}>
      <div className={tokens.text.eyebrow}>{label}</div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className={tokens.text.label}>
        {label}
      </span>
      {children}
    </label>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className={cn("rounded-xl px-6 py-12 text-center text-sm text-muted-foreground", tokens.surface.card)}>
      <LoaderCircle className="mx-auto mb-3 size-5 animate-spin" />
      {label}
    </div>
  );
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className={cn("rounded-xl px-6 py-12 text-center", tokens.surface.dashed)}>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
