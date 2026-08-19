import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Download,
  Eye,
  FileText,
  Pencil,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import {
  AdminSheetScaffold,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import {
  DataTablePager,
  useDataTablePagination,
} from "@/components/data-table/data-table-pager";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ToolbarField } from "@/components/data-table/toolbar-field";
import {
  Banner as ShellBanner,
  PageHeader,
  StatusBadge,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
  tokens,
} from "@/components/ui-shell";
import { agencyServiceNameLabel } from "@/lib/agency-service-labels";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  formatEnumLabelFromKeys,
  formatUnknownValue,
  useLang,
  type TranslationKey,
} from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { PatientInvoicesPage } from "@/pages/patients/portal-invoices-page";
import { cn } from "@/lib/utils";
import {
  dunningLevelTone,
  invoiceTypeTone,
  statusBadgeClass,
} from "./appearance/status-appearance";
import {
  applyInvoicePrepayment,
  createInvoiceCreditNote,
  createInvoicePayment,
  createDunningEvent,
  createInvoice,
  fetchAccountingLedger,
  fetchAccountingLedgerExportBlob,
  fetchInvoiceLookups,
  fetchInvoicePdfBlob,
  fetchInvoiceWorkspace,
  fetchInvoices,
  releaseInvoicePrepayment,
  reverseInvoicePayment,
  reverseInvoiceCreditNote,
  updateInvoicePayer,
  updateInvoiceStatus,
  updateInvoiceVisibility,
} from "./data/invoice-api";
import {
  DEFAULT_FILTERS,
  DEFAULT_INVOICE_PAGE_SIZE,
  INVOICE_STATUSES,
  INVOICE_TYPES,
  blankCreateForm,
  buildInvoicesPath,
  buildSearchParams,
  calculateInvoiceSelectionTotals,
  formatCurrency,
  formatDate,
  formatDateTime,
  invoiceToStatusForm,
  invoiceToPayerForm,
  invoiceToVisibilityForm,
  invoiceLineQuantityAvailable,
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
  InvoiceCreditNoteTransaction,
  InvoiceLineItem,
  InvoicePaymentTransaction,
  InvoiceStatus,
  InvoiceType,
  OrderOption,
  PayerForm,
  PatientOption,
  QuoteOption,
  StatusForm,
  VisibilityForm,
} from "./model/types";
const selectClassName = shellSelectClassName;
const textareaClassName = shellTextareaClass;
const INVOICE_DEFAULT_FROZEN_COLUMNS = ["invoice_number", "patient_name"];
const INVOICE_MAX_FROZEN_COLUMNS = 3;
const ACCOUNTING_DEFAULT_FROZEN_COLUMNS = ["entry_date", "description"];
const ACCOUNTING_MAX_FROZEN_COLUMNS = 3;

type InvoiceWorkspaceState = {
  invoices: InvoiceItem[];
  invoicePage: number;
  invoiceTotal: number;
  invoiceTotalPages: number;
  patients: PatientOption[];
  orders: OrderOption[];
  quotes: QuoteOption[];
  listBusy: boolean;
  listError: string | null;
  optionsError: string | null;
  selectedInvoiceId: string;
  detail: InvoiceItem | null;
  dunningEvents: DunningEvent[];
  paymentTransactions: InvoicePaymentTransaction[];
  creditNoteTransactions: InvoiceCreditNoteTransaction[];
  detailBusy: boolean;
  detailError: string | null;
  reloadToken: number;
  accountingYear: string;
  accountingLedger: AccountingLedgerPayload | null;
  accountingBusy: boolean;
  accountingError: string | null;
};

type InvoiceWorkspacePatch =
  | Partial<InvoiceWorkspaceState>
  | ((current: InvoiceWorkspaceState) => Partial<InvoiceWorkspaceState>);

function invoiceWorkspaceReducer(
  state: InvoiceWorkspaceState,
  patch: InvoiceWorkspacePatch,
): InvoiceWorkspaceState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

const INVOICE_STATUS_LABEL_KEYS = {
  draft: "revenue_invoice_status_draft",
  sent: "revenue_invoice_status_sent",
  partially_paid: "revenue_invoice_status_partially_paid",
  paid: "revenue_invoice_status_paid",
  overdue: "revenue_invoice_status_overdue",
  cancelled: "revenue_invoice_status_cancelled",
} satisfies Partial<Record<string, TranslationKey>>;

const INVOICE_TYPE_LABEL_KEYS = {
  advance: "revenue_invoice_type_advance",
  interim: "revenue_invoice_type_interim",
  final: "revenue_invoice_type_final",
} satisfies Partial<Record<string, TranslationKey>>;

const DUNNING_LEVEL_LABEL_KEYS = {
  first: "revenue_dunning_level_first",
  second: "revenue_dunning_level_second",
  collections: "revenue_dunning_level_collections",
} satisfies Partial<Record<string, TranslationKey>>;

const ACCOUNTING_DIRECTION_LABEL_KEYS = {
  income: "revenue_accounting_direction_income",
  expense: "revenue_accounting_direction_expense",
} satisfies Partial<Record<string, TranslationKey>>;

const ACCOUNTING_CATEGORY_LABEL_KEYS = {
  service_revenue: "revenue_accounting_category_service_revenue",
  cost_passthrough_revenue: "revenue_accounting_category_cost_passthrough_revenue",
  provider_expense: "revenue_accounting_category_provider_expense",
} satisfies Partial<Record<string, TranslationKey>>;

const REDACTION_REASON_LABEL_KEYS = {
  invoice_hidden_from_patient: "revenue_invoices_redaction_invoice_hidden",
  amounts_hidden_from_patient: "revenue_invoices_redaction_amounts_hidden",
  line_items_hidden_from_patient: "revenue_invoices_redaction_line_items_hidden",
} satisfies Partial<Record<string, TranslationKey>>;

const VAT_SOURCE_LABEL_KEYS = {
  catalog: "finance_catalog_vat_source_catalog",
  tax_profile: "finance_catalog_vat_source_tax_profile",
  manual: "finance_catalog_vat_source_manual",
  legacy: "finance_catalog_vat_source_legacy",
} satisfies Partial<Record<string, TranslationKey>>;

const STAFF_INVOICE_REALTIME_EVENTS = [
  "invoice.created",
  "invoice.status_changed",
  "invoice.payment_recorded",
  "invoice.payment_reversed",
  "invoice.dunning_created",
  "invoice.overdue_marked",
  "document.payment_proof_uploaded",
] as const;

function quoteOptionLabel(quote: QuoteOption) {
  return [
    quote.quote_number,
    quote.patient_name,
    quote.order_number,
    quote.patient_pid,
  ]
    .filter((value) => value.trim().length > 0)
    .join(" | ");
}

function cappedPrepaymentAmount(available: unknown, balanceDue: unknown) {
  const availableAmount = Number(available ?? 0);
  const balanceAmount = Number(balanceDue ?? 0);
  if (!Number.isFinite(availableAmount) || !Number.isFinite(balanceAmount)) return "";
  return Math.max(0, Math.min(availableAmount, balanceAmount)).toFixed(2);
}

async function downloadInvoicePdf(
  invoiceId: string,
  filename: string,
  fallbackFilename: string,
) {
  const blob = await fetchInvoicePdfBlob(invoiceId);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || fallbackFilename;
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

type InvoiceUiState = {
  createOpen: boolean;
  createForm: CreateForm;
  createBusy: boolean;
  createError: string | null;
  statusForm: StatusForm;
  statusBusy: boolean;
  statusError: string | null;
  statusDialogOpen: boolean;
  visibilityForm: VisibilityForm;
  visibilityBusy: boolean;
  visibilityError: string | null;
  visibilityDialogOpen: boolean;
  payerForm: PayerForm;
  payerBusy: boolean;
  payerError: string | null;
  payerDialogOpen: boolean;
  dunningBusy: boolean;
  dunningError: string | null;
  dunningForm: DunningForm;
  dunningDialogOpen: boolean;
};

type InvoiceUiAction =
  | { type: "patch"; value: Partial<InvoiceUiState> }
  | { type: "update"; updater: (state: InvoiceUiState) => InvoiceUiState };

function createInvoiceUiState(initialQuoteId = ""): InvoiceUiState {
  return {
    createOpen: false,
    createForm: blankCreateForm(initialQuoteId),
    createBusy: false,
    createError: null,
    statusForm: { status: "draft", dueDate: "", notes: "" },
    statusBusy: false,
    statusError: null,
    statusDialogOpen: false,
    visibilityForm: {
      portalVisible: true,
      hideAmountsFromPatient: false,
      lineItemsVisibleToPatient: true,
      pdfVisibleToPatient: true,
      visibilityNote: "",
    },
    visibilityBusy: false,
    visibilityError: null,
    visibilityDialogOpen: false,
    payerForm: {
      payerPatientRelationId: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      contactRelationship: "",
      notes: "",
    },
    payerBusy: false,
    payerError: null,
    payerDialogOpen: false,
    dunningBusy: false,
    dunningError: null,
    dunningForm: { note: "" },
    dunningDialogOpen: false,
  };
}

function invoiceUiReducer(state: InvoiceUiState, action: InvoiceUiAction): InvoiceUiState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.value };
    case "update":
      return action.updater(state);
    default:
      return state;
  }
}

function createInvoiceUiFieldAction<K extends keyof InvoiceUiState>(
  field: K,
  value: SetStateAction<InvoiceUiState[K]>,
): InvoiceUiAction {
  return {
    type: "update",
    updater: (state) => {
      const currentValue = state[field];
      const nextValue =
        typeof value === "function"
          ? (value as (current: InvoiceUiState[K]) => InvoiceUiState[K])(currentValue)
          : value;

      if (Object.is(currentValue, nextValue)) return state;
      return { ...state, [field]: nextValue };
    },
  };
}

function useStaffInvoicesPageContent() {
  const { t, lang } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const access = invoicesPermissions(user?.role);
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const formatMoney = (value: unknown) => formatCurrency(value, locale);
  const text = {
    accessDenied: t.invoices_workspace_access_denied,
    workspaceKicker: t.invoices_workspace_kicker,
    refresh: t.invoices_workspace_refresh,
    newInvoice: t.invoices_workspace_new_invoice,
    grossTotal: t.invoices_workspace_gross_total,
    grossTotalDescription: t.invoices_workspace_gross_total_description,
    openBalance: t.invoices_workspace_open_balance,
    openBalanceDescription: t.invoices_workspace_open_balance_description,
    quotesReady: t.invoices_workspace_quotes_ready,
    quotesReadyDescription: t.invoices_workspace_quotes_ready_description,
    accountingTitle: t.invoices_workspace_accounting_title,
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
    createInvoiceDescription: t.revenue_invoices_create_description,
    createQuoteSection: t.revenue_invoices_section_quote,
    invoiceSettingsSection: t.revenue_invoices_section_invoice_settings,
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
    linkedPatientCardDescription: t.revenue_invoices_linked_patient_card_description,
    linkedOrderCardDescription: t.revenue_invoices_linked_order_card_description,
    linkedQuoteCardDescription: t.revenue_invoices_linked_quote_card_description,
    linkedDocumentsCardDescription: t.revenue_invoices_linked_documents_card_description,
    saveInvoice: t.invoices_workspace_save_invoice,
    dunningTitle: t.invoices_workspace_dunning_title,
    dunningDescription: t.invoices_workspace_dunning_description,
    dunningHistory: t.invoices_workspace_dunning_history,
    dunningAction: t.invoices_workspace_dunning_action,
    dunningSentAt: t.invoices_workspace_dunning_sent_at,
    dunningResponsible: t.invoices_workspace_dunning_responsible,
    dunningBalanceDue: t.invoices_workspace_dunning_balance_due,
    createDunning: t.invoices_workspace_create_dunning,
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
    pdfOpenError: t.invoices_workspace_pdf_open_error,
    pdfDownloadError: t.invoices_workspace_pdf_download_error,
    system: t.invoices_workspace_system,
    statsSentWord: t.invoices_workspace_stats_sent_word,
    statsPaidWord: t.invoices_workspace_stats_paid_word,
    pageOf: t.invoices_workspace_page_of,
    linkedOrder: t.invoices_workspace_linked_order,
    ledgerDate: t.revenue_invoices_ledger_date,
    ledgerDirection: t.revenue_invoices_ledger_direction,
    ledgerEntry: t.revenue_invoices_ledger_entry,
    ledgerCategory: t.revenue_invoices_ledger_category,
    ledgerPeriod: t.revenue_invoices_ledger_period,
    vatSource: t.revenue_invoices_vat_source,
    invoiceLines: lang === "de" ? "Rechnungspositionen" : "Позиции счета",
    invoiceLinesDescription:
      lang === "de"
        ? "Positionen und Mengen für diese Rechnung auswählen. Preise, Beschreibung und USt. bleiben als Snapshot erhalten."
        : "Выберите позиции и количество для этого счёта. Цена, описание и НДС сохраняются как снимок.",
    selectionNet: lang === "de" ? "Netto" : "Нетто",
    selectionVat: lang === "de" ? "Umsatzsteuer" : "НДС",
    selectionGross: lang === "de" ? "Zahlbetrag brutto" : "К оплате брутто",
    advanceVatTitle:
      lang === "de" ? "Vorauszahlung inklusive Umsatzsteuer" : "Предоплата с учетом НДС",
    advanceVatDescription:
      lang === "de"
        ? "Der Patient zahlt den Bruttobetrag: ausgewählter Nettowert plus Umsatzsteuer. Dieser Bruttobetrag steht später zur Anrechnung auf Rechnungen bereit."
        : "Пациент оплачивает сумму брутто: выбранная сумма нетто плюс НДС. Именно сумма брутто затем доступна для зачета в последующих счетах.",
    selectAllLines: lang === "de" ? "Alle Positionen" : "Все позиции",
    prepayment: lang === "de" ? "Vorauszahlung" : "Предоплата",
    prepaymentApplied:
      lang === "de" ? "Angerechnete Vorauszahlung" : "Зачтенная предоплата",
    applyPrepayment:
      lang === "de" ? "Vorauszahlung anrechnen" : "Зачесть предоплату",
    availableAdvance:
      lang === "de" ? "Verfügbare Vorauszahlung" : "Доступная предоплата",
    amountToApply: lang === "de" ? "Anzurechnender Bruttobetrag" : "Сумма зачета брутто",
    payments: lang === "de" ? "Zahlungseingänge" : "Поступления по счёту",
    paymentsDescription:
      lang === "de"
        ? "Unveränderbares Journal einzelner Zahlungen und Stornierungen."
        : "Неизменяемый журнал отдельных платежей и их сторнирований.",
    recordPayment: lang === "de" ? "Zahlung erfassen" : "Записать платёж",
    paymentAmount: lang === "de" ? "Eingang brutto" : "Сумма брутто",
    paymentMethod: lang === "de" ? "Zahlungsart" : "Способ оплаты",
    paymentReference: lang === "de" ? "Referenz" : "Референс",
    paymentDate: lang === "de" ? "Eingangsdatum" : "Дата поступления",
    paymentNote: lang === "de" ? "Interne Notiz" : "Внутренняя заметка",
    noPayments: lang === "de" ? "Noch keine Zahlungen erfasst." : "Платежей ещё нет.",
    reversal: lang === "de" ? "Stornierung" : "Сторнирование",
    reversePayment: lang === "de" ? "Zahlung stornieren" : "Сторнировать платёж",
    reversalReason: lang === "de" ? "Stornogrund" : "Причина сторнирования",
    reversed: lang === "de" ? "Storniert" : "Сторнирован",
    paymentMethods: {
      bank_transfer: lang === "de" ? "Überweisung" : "Банковский перевод",
      card: lang === "de" ? "Karte" : "Карта",
      cash: lang === "de" ? "Bar" : "Наличные",
      direct_debit: lang === "de" ? "Lastschrift" : "Прямое списание",
      cheque: lang === "de" ? "Scheck" : "Чек",
      other: lang === "de" ? "Sonstige" : "Другое",
      legacy_import: lang === "de" ? "Übernommener Bestand" : "Перенесённый остаток",
    } as Record<string, string>,
    sendDunning: (level: string) => t.invoices_workspace_send_dunning.replace("{level}", level),
  };
  const invoiceColumnGroups = {
    identity: t.revenue_table_group_identity,
    context: t.revenue_table_group_context,
    status: t.revenue_table_group_status,
    finance: t.revenue_table_group_finance,
    audit: t.revenue_table_group_audit,
  };
  const accountingColumnGroups = {
    accounting: t.revenue_table_group_accounting,
    context: t.revenue_table_group_context,
    finance: t.revenue_table_group_finance,
    audit: t.revenue_table_group_audit,
  };
  const invoiceStatusLabel = (status: string) =>
    formatEnumLabelFromKeys(status, INVOICE_STATUS_LABEL_KEYS, t);
  const invoiceTypeLabel = (invoiceType: string) =>
    formatEnumLabelFromKeys(invoiceType, INVOICE_TYPE_LABEL_KEYS, t);
  const dunningLevelLabel = (level: string) =>
    formatEnumLabelFromKeys(level, DUNNING_LEVEL_LABEL_KEYS, t);
  const accountingDirectionLabel = (direction: string) =>
    formatEnumLabelFromKeys(direction, ACCOUNTING_DIRECTION_LABEL_KEYS, t);
  const accountingCategoryLabel = (category: string) =>
    formatEnumLabelFromKeys(category, ACCOUNTING_CATEGORY_LABEL_KEYS, t);
  const redactionReasonLabel = (reason: string | null | undefined) =>
    formatEnumLabelFromKeys(reason, REDACTION_REASON_LABEL_KEYS, t);
  const vatSourceLabel = (source: string | null | undefined) =>
    formatEnumLabelFromKeys(source, VAT_SOURCE_LABEL_KEYS, t);
  const taxProfileLabel = (
    name: string | null | undefined,
    key: string | null | undefined,
    source: string | null | undefined,
  ) => {
    const trimmedName = name?.trim();
    if (trimmedName) return trimmedName;
    if (key?.trim()) return formatUnknownValue(key, t);
    if (source?.trim()) return vatSourceLabel(source);
    return text.vatSource;
  };
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
  const [workspaceState, dispatchWorkspaceState] = useReducer(
    invoiceWorkspaceReducer,
    undefined,
    () => ({
      invoices: [],
      invoicePage: initialPage,
      invoiceTotal: 0,
      invoiceTotalPages: 1,
      patients: [],
      orders: [],
      quotes: [],
      listBusy: false,
      listError: null,
      optionsError: null,
      selectedInvoiceId: initialInvoiceId,
      detail: null,
      dunningEvents: [],
      paymentTransactions: [],
      creditNoteTransactions: [],
      detailBusy: false,
      detailError: null,
      reloadToken: 0,
      accountingYear: currentYear,
      accountingLedger: null,
      accountingBusy: false,
      accountingError: null,
    }),
  );
  const {
    invoices,
    invoicePage,
    invoiceTotal,
    invoiceTotalPages,
    patients,
    orders,
    quotes,
    listBusy,
    listError,
    optionsError,
    selectedInvoiceId,
    detail,
    dunningEvents,
    paymentTransactions,
    creditNoteTransactions,
    detailBusy,
    detailError,
    reloadToken,
    accountingYear,
    accountingLedger,
    accountingBusy,
    accountingError,
  } = workspaceState;
  const setInvoicePage = (nextValue: SetStateAction<number>) => {
    dispatchWorkspaceState((current) => ({
      invoicePage:
        typeof nextValue === "function"
          ? nextValue(current.invoicePage)
          : nextValue,
    }));
  };
  const setReloadToken = (nextValue: SetStateAction<number>) => {
    dispatchWorkspaceState((current) => ({
      reloadToken:
        typeof nextValue === "function"
          ? nextValue(current.reloadToken)
          : nextValue,
    }));
  };
  const setSelectedInvoiceId = (nextValue: SetStateAction<string>) => {
    dispatchWorkspaceState((current) => ({
      selectedInvoiceId:
        typeof nextValue === "function"
          ? nextValue(current.selectedInvoiceId)
          : nextValue,
    }));
  };
  const setDetail = (nextValue: SetStateAction<InvoiceItem | null>) => {
    dispatchWorkspaceState((current) => ({
      detail:
        typeof nextValue === "function"
          ? nextValue(current.detail)
          : nextValue,
    }));
  };
  const setDunningEvents = (nextValue: SetStateAction<DunningEvent[]>) => {
    dispatchWorkspaceState((current) => ({
      dunningEvents:
        typeof nextValue === "function"
          ? nextValue(current.dunningEvents)
          : nextValue,
    }));
  };
  const setDetailError = (nextValue: SetStateAction<string | null>) => {
    dispatchWorkspaceState((current) => ({
      detailError:
        typeof nextValue === "function"
          ? nextValue(current.detailError)
          : nextValue,
    }));
  };
  const setAccountingYear = (nextValue: SetStateAction<string>) => {
    dispatchWorkspaceState((current) => ({
      accountingYear:
        typeof nextValue === "function"
          ? nextValue(current.accountingYear)
          : nextValue,
    }));
  };
  const setAccountingError = (nextValue: SetStateAction<string | null>) => {
    dispatchWorkspaceState((current) => ({
      accountingError:
        typeof nextValue === "function"
          ? nextValue(current.accountingError)
          : nextValue,
    }));
  };
  const [
    {
      createOpen,
      createForm,
      createBusy,
      createError,
      statusForm,
      statusBusy,
      statusError,
      statusDialogOpen,
      visibilityForm,
      visibilityBusy,
      visibilityError,
      visibilityDialogOpen,
      payerForm,
      payerBusy,
      payerError,
      payerDialogOpen,
      dunningBusy,
      dunningError,
      dunningForm,
      dunningDialogOpen,
    },
    dispatchInvoiceUiState,
  ] = useReducer(invoiceUiReducer, initialQuoteId, createInvoiceUiState);
  const setInvoiceUiField = <K extends keyof InvoiceUiState>(
    field: K,
    value: SetStateAction<InvoiceUiState[K]>,
  ) => dispatchInvoiceUiState(createInvoiceUiFieldAction(field, value));
  const setCreateOpen = (value: SetStateAction<boolean>) =>
    setInvoiceUiField("createOpen", value);
  const setCreateForm = (value: SetStateAction<CreateForm>) =>
    setInvoiceUiField("createForm", value);
  const setCreateBusy = (value: SetStateAction<boolean>) =>
    setInvoiceUiField("createBusy", value);
  const setCreateError = (value: SetStateAction<string | null>) =>
    setInvoiceUiField("createError", value);
  const setStatusForm = (value: SetStateAction<StatusForm>) =>
    setInvoiceUiField("statusForm", value);
  const setStatusBusy = (value: SetStateAction<boolean>) =>
    setInvoiceUiField("statusBusy", value);
  const setStatusError = (value: SetStateAction<string | null>) =>
    setInvoiceUiField("statusError", value);
  const setStatusDialogOpen = (value: SetStateAction<boolean>) =>
    setInvoiceUiField("statusDialogOpen", value);
  const setVisibilityForm = (value: SetStateAction<VisibilityForm>) =>
    setInvoiceUiField("visibilityForm", value);
  const setVisibilityBusy = (value: SetStateAction<boolean>) =>
    setInvoiceUiField("visibilityBusy", value);
  const setVisibilityError = (value: SetStateAction<string | null>) =>
    setInvoiceUiField("visibilityError", value);
  const setVisibilityDialogOpen = (value: SetStateAction<boolean>) =>
    setInvoiceUiField("visibilityDialogOpen", value);
  const setPayerForm = (value: SetStateAction<PayerForm>) =>
    setInvoiceUiField("payerForm", value);
  const setPayerBusy = (value: SetStateAction<boolean>) =>
    setInvoiceUiField("payerBusy", value);
  const setPayerError = (value: SetStateAction<string | null>) =>
    setInvoiceUiField("payerError", value);
  const setPayerDialogOpen = (value: SetStateAction<boolean>) =>
    setInvoiceUiField("payerDialogOpen", value);
  const setDunningBusy = (value: SetStateAction<boolean>) =>
    setInvoiceUiField("dunningBusy", value);
  const setDunningError = (value: SetStateAction<string | null>) =>
    setInvoiceUiField("dunningError", value);
  const setDunningForm = (value: SetStateAction<DunningForm>) =>
    setInvoiceUiField("dunningForm", value);
  const setDunningDialogOpen = (value: SetStateAction<boolean>) =>
    setInvoiceUiField("dunningDialogOpen", value);
  const [invoicePdfPreview, setInvoicePdfPreview] = useState<{
    url: string;
    title: string;
  } | null>(null);
  const [invoicePdfPreviewBusy, setInvoicePdfPreviewBusy] = useState(false);
  const [prepaymentInvoiceId, setPrepaymentInvoiceId] = useState("");
  const [prepaymentAmount, setPrepaymentAmount] = useState("");
  const [prepaymentRequestId, setPrepaymentRequestId] = useState(() => crypto.randomUUID());
  const [prepaymentBusy, setPrepaymentBusy] = useState(false);
  const [prepaymentError, setPrepaymentError] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    requestId: crypto.randomUUID(),
    amountGross: "",
    paymentMethod: "bank_transfer",
    paymentReference: "",
    receivedOn: new Date().toISOString().slice(0, 10),
    note: "",
  });
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [reversingPaymentId, setReversingPaymentId] = useState("");
  const [reversalNote, setReversalNote] = useState("");
  const [creditNoteForm, setCreditNoteForm] = useState({
    requestId: crypto.randomUUID(),
    amountGross: "",
    reason: "",
    issuedOn: new Date().toISOString().slice(0, 10),
    portalVisible: true,
  });
  const [creditNoteBusy, setCreditNoteBusy] = useState(false);
  const [creditNoteError, setCreditNoteError] = useState<string | null>(null);
  const [reversingCreditNoteId, setReversingCreditNoteId] = useState("");
  const [creditNoteReversalReason, setCreditNoteReversalReason] = useState("");
  const deferredSearch = useDeferredValue(filters.search);
  const effectiveFilters = useMemo(() => ({ ...filters, search: deferredSearch }), [filters, deferredSearch]);

  const syncQuery = (
    patch: Record<string, string | null | undefined>,
    options: { replace?: boolean } = {},
  ) => {
    setSearchParams((current) => buildSearchParams(current, patch), {
      replace: options.replace ?? true,
    });
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
  const selectedCreateQuote = useMemo(() => quotes.find((quote) => quote.id === createForm.quoteId) ?? null, [quotes, createForm.quoteId]);
  const selectedCreateTotals = useMemo(
    () =>
      calculateInvoiceSelectionTotals(
        selectedCreateQuote?.line_items ?? [],
        createForm.selectedLineIndexes,
        createForm.lineQuantities,
      ),
    [
      createForm.lineQuantities,
      createForm.selectedLineIndexes,
      selectedCreateQuote?.line_items,
    ],
  );
  const anyQuickFilterActive =
    filters.search.trim() !== "" ||
    filters.patientId !== "" ||
    filters.orderId !== "" ||
    filters.quoteId !== "" ||
    filters.status !== "" ||
    filters.invoiceType !== "";
  const invoiceParam = searchParams.get("invoice") ?? "";

  useEffect(() => {
    if (!selectedCreateQuote || Object.keys(createForm.lineQuantities).length > 0) return;
    setCreateForm((current) => ({
      ...current,
      selectedLineIndexes: selectedCreateQuote.line_items.flatMap((line, index) =>
        invoiceLineQuantityAvailable(line, createForm.invoiceType) > 0 ? [index] : [],
      ),
      lineQuantities: Object.fromEntries(
        selectedCreateQuote.line_items.map((line, index) => [
          String(index),
          String(invoiceLineQuantityAvailable(line, createForm.invoiceType) || "1"),
        ]),
      ),
    }));
  }, [createForm.invoiceType, createForm.lineQuantities, selectedCreateQuote]);

  useEffect(() => {
    const firstAvailable = detail?.available_prepayments?.[0];
    setPrepaymentInvoiceId(firstAvailable?.invoice_id ?? "");
    setPrepaymentAmount(
      firstAvailable
        ? cappedPrepaymentAmount(
            firstAvailable.available_amount,
            detail?.balance_due,
          )
        : "",
    );
    setPrepaymentRequestId(crypto.randomUUID());
    setPrepaymentError(null);
  }, [detail?.id, detail?.available_prepayments]);

  useEffect(() => {
    const balance = Number(detail?.balance_due ?? 0);
    setPaymentForm({
      requestId: crypto.randomUUID(),
      amountGross: Number.isFinite(balance) && balance > 0 ? balance.toFixed(2) : "",
      paymentMethod: "bank_transfer",
      paymentReference: "",
      receivedOn: new Date().toISOString().slice(0, 10),
      note: "",
    });
    setPaymentError(null);
    setReversingPaymentId("");
    setReversalNote("");
  }, [detail?.id, detail?.balance_due]);

  useEffect(() => {
    return () => {
      if (invoicePdfPreview?.url) {
        URL.revokeObjectURL(invoicePdfPreview.url);
      }
    };
  }, [invoicePdfPreview?.url]);

  async function handleOpenInvoicePdfPreview(invoice: InvoiceItem) {
    setInvoicePdfPreviewBusy(true);
    setDetailError(null);
    try {
      const blob = await fetchInvoicePdfBlob(invoice.id);
      const url = URL.createObjectURL(blob);
      setInvoicePdfPreview({
        url,
        title: invoice.invoice_number
          ? `${invoice.invoice_number}.pdf`
          : t.revenue_invoices_pdf_fallback_filename,
      });
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : text.pdfOpenError);
    } finally {
      setInvoicePdfPreviewBusy(false);
    }
  }

  useEffect(() => {
    if (selectedInvoiceId === invoiceParam) return;
    setSelectedInvoiceId(invoiceParam);
  }, [invoiceParam, selectedInvoiceId]);

  useDebouncedRealtimeSubscription(STAFF_INVOICE_REALTIME_EVENTS, (_event, events) => {
    if (!access.canView) return;
    clearApiCache("/invoices");
    clearApiCache("/invoices/accounting-ledger");
    for (const event of events) {
      if (event.entity_type === "invoice") {
        clearApiCache(`/invoices/${event.entity_id}`);
      }
    }
    if (selectedInvoiceId) {
      clearApiCache(`/invoices/${selectedInvoiceId}`);
    }
    setReloadToken((current) => current + 1);
  }, 250);

  const invoiceTableColumns: ColumnDef<InvoiceItem>[] = [
      {
        id: "invoice_number",
        label: t.invoices_number,
        accessor: (row) => row.invoice_number,
        filterType: "text",
        group: "identity",
        sortable: true,
        searchable: true,
        required: true,
        pinned: "left",
        width: 180,
        render: (row) => (
          <span className="font-mono text-xs tracking-[0.14em] text-foreground">
            {row.invoice_number}
          </span>
        ),
      },
      {
        id: "issued_at",
        label: t.invoices_issued_at,
        accessor: (row) => row.issued_at,
        filterType: "date",
        group: "audit",
        sortable: true,
        width: 170,
        render: (row) => formatDateTime(row.issued_at, locale, t.common_not_set),
      },
      {
        id: "patient_name",
        label: t.invoices_patient,
        accessor: (row) => row.patient_name,
        filterType: "text",
        group: "identity",
        sortable: true,
        searchable: true,
        required: true,
        pinned: "left",
        width: 220,
        render: (row) => (
          <span className="font-mono text-xs text-foreground">{row.patient_name}</span>
        ),
      },
      {
        id: "patient_pid",
        label: t.revenue_common_patient_id,
        accessor: (row) => row.patient_pid,
        sortable: true,
        width: 130,
        render: (row) => <span className="text-xs text-foreground">{row.patient_pid}</span>,
      },
      {
        id: "order_number",
        label: t.orders_title,
        accessor: (row) => row.order_number,
        filterType: "text",
        group: "context",
        sortable: true,
        searchable: true,
        width: 180,
      },
      {
        id: "quote_number",
        label: text.createQuoteSection,
        accessor: (row) => row.quote_number ?? "",
        filterType: "text",
        group: "context",
        sortable: true,
        searchable: true,
        width: 160,
        render: (row) => row.quote_number ?? t.common_not_set,
      },
      {
        id: "invoice_type",
        label: t.invoices_type,
        accessor: (row) => row.invoice_type,
        filterType: "enum",
        filterOptions: INVOICE_TYPES.map((invoiceType) => ({
          value: invoiceType,
          label: invoiceTypeLabel(invoiceType),
        })),
        group: "status",
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
        filterType: "enum",
        filterOptions: INVOICE_STATUSES.map((status) => ({
          value: status,
          label: invoiceStatusLabel(status),
        })),
        group: "status",
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
        filterType: "date",
        group: "audit",
        sortable: true,
        width: 150,
        render: (row) => formatDate(row.due_date, locale, t.common_not_set),
      },
      {
        id: "paid_amount",
        label: t.invoices_paid,
        accessor: (row) => Number(row.paid_amount ?? 0),
        filterType: "number",
        group: "finance",
        sortable: true,
        width: 140,
        render: (row) => (
          <span className="block text-right tabular-nums text-foreground">
            {formatMoney(row.paid_amount)}
          </span>
        ),
      },
      {
        id: "balance_due",
        label: text.balance,
        accessor: (row) => Number(row.balance_due ?? 0),
        filterType: "number",
        group: "finance",
        sortable: true,
        width: 140,
        render: (row) => (
          <span className="block text-right tabular-nums text-foreground">
            {formatMoney(row.balance_due)}
          </span>
        ),
      },
      {
        id: "total_gross",
        label: t.invoices_total,
        accessor: (row) => Number(row.total_gross ?? 0),
        filterType: "number",
        group: "finance",
        sortable: true,
        width: 150,
        render: (row) => (
          <span className="block text-right tabular-nums text-foreground">
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
      filterType: "date",
      group: "audit",
      sortable: true,
      required: true,
      pinned: "left",
      width: 130,
      render: (row) => formatDate(row.entry_date, locale, t.common_not_set),
    },
    {
      id: "direction",
      label: text.ledgerDirection,
      accessor: (row) => row.direction,
      filterType: "enum",
      filterOptions: ["income", "expense"].map((direction) => ({
        value: direction,
        label: accountingDirectionLabel(direction),
      })),
      group: "accounting",
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
      filterType: "text",
      group: "context",
      sortable: true,
      searchable: true,
      width: 170,
      render: (row) => (
        <span className="font-mono text-xs text-foreground">
          {row.invoice_number ?? row.external_invoice_number ?? t.common_not_set}
        </span>
      ),
    },
    {
      id: "description",
      label: text.ledgerEntry,
      accessor: (row) => row.description,
      filterType: "text",
      group: "accounting",
      sortable: true,
      searchable: true,
      pinned: "left",
      width: 260,
      render: (row) => (
        <span className="block truncate font-mono text-xs text-foreground">
          {row.description}
        </span>
      ),
    },
    {
      id: "category",
      label: text.ledgerCategory,
      accessor: (row) => accountingCategoryLabel(row.category),
      filterType: "text",
      group: "accounting",
      sortable: true,
      width: 150,
      render: (row) => (
        <span className="block truncate text-xs text-foreground">
          {accountingCategoryLabel(row.category)}
        </span>
      ),
    },
    {
      id: "order_number",
      label: t.orders_title,
      accessor: (row) => row.order_number ?? "",
      filterType: "text",
      group: "context",
      sortable: true,
      searchable: true,
      width: 160,
      render: (row) => row.order_number ?? text.noOrder,
    },
    {
      id: "patient_name",
      label: t.invoices_patient,
      accessor: (row) => row.patient_name ?? "",
      filterType: "text",
      group: "context",
      sortable: true,
      searchable: true,
      width: 210,
      render: (row) => row.patient_name || text.noPatient,
    },
    {
      id: "patient_pid",
      label: t.revenue_common_patient_id,
      accessor: (row) => row.patient_pid ?? "",
      filterType: "text",
      group: "context",
      sortable: true,
      searchable: true,
      width: 120,
      render: (row) => row.patient_pid || t.common_not_set,
    },
    {
      id: "amount_net",
      label: text.net,
      accessor: (row) => Number(row.amount_net ?? 0),
      filterType: "number",
      group: "finance",
      sortable: true,
      width: 130,
      render: (row) => (
        <span className="block text-right tabular-nums text-foreground">
          {formatMoney(row.amount_net)}
        </span>
      ),
    },
    {
      id: "amount_vat",
      label: t.invoices_vat,
      accessor: (row) => Number(row.amount_vat ?? 0),
      filterType: "number",
      group: "finance",
      sortable: true,
      width: 130,
      render: (row) => (
        <span className="block text-right tabular-nums text-foreground">
          {formatMoney(row.amount_vat)}
        </span>
      ),
    },
    {
      id: "amount_gross",
      label: text.gross,
      accessor: (row) => Number(row.amount_gross ?? 0),
      filterType: "number",
      group: "finance",
      sortable: true,
      width: 140,
      render: (row) => (
        <span className="block text-right tabular-nums text-foreground">
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
      filterType: "text",
      group: "audit",
      sortable: true,
      required: true,
      pinned: "left",
      width: 160,
      render: (row) => <span className="text-foreground">{row.period}</span>,
    },
    {
      id: "income_gross",
      label: text.income,
      accessor: (row) => Number(row.income_gross ?? 0),
      filterType: "number",
      group: "finance",
      sortable: true,
      width: 170,
      render: (row) => (
        <span className="block text-right tabular-nums text-foreground">
          {formatMoney(row.income_gross)}
        </span>
      ),
    },
    {
      id: "expense_gross",
      label: text.expense,
      accessor: (row) => Number(row.expense_gross ?? 0),
      filterType: "number",
      group: "finance",
      sortable: true,
      width: 170,
      render: (row) => (
        <span className="block text-right tabular-nums text-foreground">
          {formatMoney(row.expense_gross)}
        </span>
      ),
    },
    {
      id: "net_surplus",
      label: text.surplus,
      accessor: (row) => Number(row.net_surplus ?? 0),
      filterType: "number",
      group: "finance",
      sortable: true,
      width: 180,
      render: (row) => {
        const value = Number(row.net_surplus ?? 0);
        return (
          <span
            className={cn(
              "block text-right tabular-nums",
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
  const accountingEntries = Array.isArray(accountingLedger?.entries) ? accountingLedger.entries : [];
  const accountingMonthly = Array.isArray(accountingLedger?.monthly) ? accountingLedger.monthly : [];
  const accountingEntriesPagination = useDataTablePagination(
    accountingEntries,
    accountingYear,
  );
  const accountingMonthlyPagination = useDataTablePagination(
    accountingMonthly,
    accountingYear,
  );
  const applyLoadedInvoiceDetail = useCallback((
    data: NonNullable<typeof detail>,
    dunning: typeof dunningEvents,
    payments: InvoicePaymentTransaction[],
    creditNotes: InvoiceCreditNoteTransaction[],
  ) => {
    setStatusForm(invoiceToStatusForm(data));
    setVisibilityForm(invoiceToVisibilityForm(data));
    setPayerForm(invoiceToPayerForm(data));
    setDunningForm({ note: "" });
    setDunningError(null);
    setVisibilityError(null);
    setPayerError(null);
    dispatchWorkspaceState({
      detail: data,
      dunningEvents: dunning,
      paymentTransactions: payments,
      creditNoteTransactions: creditNotes,
      detailError: null,
      detailBusy: false,
    });
  }, []);

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
        dispatchWorkspaceState({
          patients: patientsResult,
          orders: ordersResult,
          quotes: quotesResult,
          optionsError: null,
        });
      } catch (error) {
        if (!ignore) {
          dispatchWorkspaceState({
            optionsError: error instanceof Error ? error.message : t.common_error,
          });
        }
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
      dispatchWorkspaceState({ listBusy: true });
      try {
        const data = await fetchInvoices(buildInvoicesPath(effectiveFilters, invoicePage));
        if (!ignore) {
          dispatchWorkspaceState({
            invoices: Array.isArray(data.items) ? data.items : [],
            invoiceTotal: typeof data.total === "number" ? data.total : 0,
            invoiceTotalPages:
              typeof data.total_pages === "number" && data.total_pages > 0
                ? data.total_pages
                : 1,
            invoicePage:
              typeof data.page === "number" && data.page > 0
                ? data.page
                : invoicePage,
            listError: null,
            listBusy: false,
          });
        }
      } catch (error) {
        if (!ignore) {
          dispatchWorkspaceState({
            listError: error instanceof Error ? error.message : t.common_error,
            listBusy: false,
          });
        }
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
      dispatchWorkspaceState({
        detail: null,
        dunningEvents: [],
        paymentTransactions: [],
        creditNoteTransactions: [],
        detailError: null,
      });
      return;
    }
    let ignore = false;
    async function loadDetail() {
      dispatchWorkspaceState({ detailBusy: true });
      try {
        const { invoice: data, dunning, payments, creditNotes } =
          await fetchInvoiceWorkspace(selectedInvoiceId);
        if (!ignore) {
          applyLoadedInvoiceDetail(data, dunning, payments, creditNotes);
        }
      } catch (error) {
        if (!ignore) {
          dispatchWorkspaceState({
            detailError: error instanceof Error ? error.message : t.common_error,
            detailBusy: false,
          });
        }
      }
    }
    void loadDetail();
    return () => {
      ignore = true;
    };
  }, [applyLoadedInvoiceDetail, selectedInvoiceId, reloadToken, t.common_error]);

  useEffect(() => {
    if (!access.canAccounting) {
      dispatchWorkspaceState({
        accountingLedger: null,
        accountingError: null,
        accountingBusy: false,
      });
      return;
    }
    let ignore = false;
    async function loadAccountingLedger() {
      dispatchWorkspaceState({ accountingBusy: true });
      try {
        const data = await fetchAccountingLedger(accountingYear);
        if (!ignore) {
          dispatchWorkspaceState({
            accountingLedger: data,
            accountingError: null,
            accountingBusy: false,
          });
        }
      } catch (error) {
        if (!ignore) {
          dispatchWorkspaceState({
            accountingError:
              error instanceof Error ? error.message : t.common_error,
            accountingBusy: false,
          });
        }
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
      const selectedLines = createForm.selectedLineIndexes.map((lineIndex) => ({
        line_index: lineIndex,
        quantity: Number(createForm.lineQuantities[String(lineIndex)] || 0),
      }));
      if (selectedLines.length === 0 || selectedLines.some((line) => line.quantity <= 0)) {
        setCreateError(text.invoiceLinesDescription);
        return;
      }
      const created = await createInvoice(createForm.quoteId, {
        invoice_type: createForm.invoiceType,
        due_date: createForm.dueDate || null,
        notes: createForm.notes.trim() || null,
        line_items: selectedLines,
      });
      setCreateOpen(false);
      setCreateForm(blankCreateForm(filters.quoteId));
      setCreateError(null);
      setReloadToken((current) => current + 1);
      setSelectedInvoiceId(created.id);
      syncQuery({ invoice: created.id }, { replace: false });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleApplyPrepayment() {
    if (!detail || !prepaymentInvoiceId || Number(prepaymentAmount) <= 0) return;
    setPrepaymentBusy(true);
    setPrepaymentError(null);
    try {
      const updated = await applyInvoicePrepayment(detail.id, {
        request_id: prepaymentRequestId,
        advance_invoice_id: prepaymentInvoiceId,
        amount_gross: Number(prepaymentAmount),
      });
      setDetail(updated);
      setPrepaymentRequestId(crypto.randomUUID());
      setReloadToken((current) => current + 1);
    } catch (error) {
      setPrepaymentError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setPrepaymentBusy(false);
    }
  }

  async function handleRecordPayment() {
    if (!detail || Number(paymentForm.amountGross) <= 0) return;
    setPaymentBusy(true);
    setPaymentError(null);
    try {
      await createInvoicePayment(detail.id, {
        request_id: paymentForm.requestId,
        amount_gross: Number(paymentForm.amountGross),
        payment_method: paymentForm.paymentMethod,
        payment_reference: paymentForm.paymentReference.trim() || null,
        received_on: paymentForm.receivedOn,
        note: paymentForm.note.trim() || null,
      });
      setPaymentForm((current) => ({
        ...current,
        requestId: crypto.randomUUID(),
      }));
      setReloadToken((current) => current + 1);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setPaymentBusy(false);
    }
  }

  async function handleReversePayment(paymentId: string) {
    if (!detail || !reversalNote.trim()) return;
    setPaymentBusy(true);
    setPaymentError(null);
    try {
      await reverseInvoicePayment(detail.id, paymentId, {
        reversed_on: new Date().toISOString().slice(0, 10),
        note: reversalNote.trim(),
      });
      setReversingPaymentId("");
      setReversalNote("");
      setReloadToken((current) => current + 1);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setPaymentBusy(false);
    }
  }

  async function handleCreateCreditNote() {
    if (!detail || Number(creditNoteForm.amountGross) <= 0 || !creditNoteForm.reason.trim()) return;
    setCreditNoteBusy(true);
    setCreditNoteError(null);
    try {
      await createInvoiceCreditNote(detail.id, {
        request_id: creditNoteForm.requestId,
        amount_gross: Number(creditNoteForm.amountGross),
        reason: creditNoteForm.reason.trim(),
        issued_on: creditNoteForm.issuedOn,
        portal_visible: creditNoteForm.portalVisible,
      });
      setCreditNoteForm({
        requestId: crypto.randomUUID(),
        amountGross: "",
        reason: "",
        issuedOn: new Date().toISOString().slice(0, 10),
        portalVisible: true,
      });
      setReloadToken((current) => current + 1);
    } catch (error) {
      setCreditNoteError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setCreditNoteBusy(false);
    }
  }

  async function handleReverseCreditNote(creditNoteId: string) {
    if (!detail || !creditNoteReversalReason.trim()) return;
    setCreditNoteBusy(true);
    setCreditNoteError(null);
    try {
      await reverseInvoiceCreditNote(detail.id, creditNoteId, {
        reason: creditNoteReversalReason.trim(),
        issued_on: new Date().toISOString().slice(0, 10),
      });
      setReversingCreditNoteId("");
      setCreditNoteReversalReason("");
      setReloadToken((current) => current + 1);
    } catch (error) {
      setCreditNoteError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setCreditNoteBusy(false);
    }
  }

  async function handleReleasePrepayment(allocationId: string) {
    if (!detail) return;
    setPrepaymentBusy(true);
    setPrepaymentError(null);
    try {
      const updated = await releaseInvoicePrepayment(detail.id, allocationId);
      setDetail(updated);
      setReloadToken((current) => current + 1);
    } catch (error) {
      setPrepaymentError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setPrepaymentBusy(false);
    }
  }

  async function handleSaveStatus() {
    if (!selectedInvoiceId) return;
    setStatusBusy(true);
    try {
      await updateInvoiceStatus(selectedInvoiceId, {
        status: statusForm.status,
        due_date: statusForm.dueDate || null,
        notes: statusForm.notes.trim() || null,
      });
      setStatusError(null);
      setReloadToken((current) => current + 1);
      setStatusDialogOpen(false);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setStatusBusy(false);
    }
  }

  async function handleSaveVisibility() {
    if (!selectedInvoiceId) return;
    setVisibilityBusy(true);
    try {
      await updateInvoiceVisibility(selectedInvoiceId, {
        portal_visible: visibilityForm.portalVisible,
        hide_amounts_from_patient: visibilityForm.hideAmountsFromPatient,
        line_items_visible_to_patient: visibilityForm.lineItemsVisibleToPatient,
        pdf_visible_to_patient: visibilityForm.pdfVisibleToPatient,
        visibility_note: visibilityForm.visibilityNote.trim() || null,
      });
      setVisibilityError(null);
      setReloadToken((current) => current + 1);
      setVisibilityDialogOpen(false);
    } catch (error) {
      setVisibilityError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function handleSavePayer() {
    if (!selectedInvoiceId) return;
    setPayerBusy(true);
    try {
      await updateInvoicePayer(selectedInvoiceId, {
        payer_patient_relation_id: payerForm.payerPatientRelationId || null,
        payer_contact_name: payerForm.contactName.trim() || null,
        payer_contact_email: payerForm.contactEmail.trim() || null,
        payer_contact_phone: payerForm.contactPhone.trim() || null,
        payer_contact_relationship: payerForm.contactRelationship.trim() || null,
        payer_notes: payerForm.notes.trim() || null,
      });
      setPayerError(null);
      setReloadToken((current) => current + 1);
      setPayerDialogOpen(false);
    } catch (error) {
      setPayerError(error instanceof Error ? error.message : t.common_error);
    } finally {
      setPayerBusy(false);
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
      setDunningDialogOpen(false);
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
    syncQuery({ invoice: invoiceId }, { replace: false });
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
      <div className="space-y-5">
        <PageHeader
          title={t.invoices_title}
          actions={(
            <>
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

        {access.canAccounting ? (
          <>
            <div className="space-y-2">
              {accountingError ? (
                <ShellBanner tone="error">{accountingError}</ShellBanner>
              ) : null}
              {accountingLedger || accountingBusy ? (
                <DataTableSurface
                  loading={accountingBusy}
                  rows={accountingEntriesPagination.pagedRows}
                  columns={accountingTableColumns}
                  rowId={(row) => row.id}
                  defaultDensity="comfortable"
                  defaultFrozenColumns={ACCOUNTING_DEFAULT_FROZEN_COLUMNS}
                  dictionary={t as unknown as Record<string, string>}
                  groupLabels={accountingColumnGroups}
                  maxFrozenColumns={ACCOUNTING_MAX_FROZEN_COLUMNS}
                  toolbarStart={
                    <>
                      <span className="flex h-8 shrink-0 items-center self-end text-[13px] font-semibold tracking-tight text-foreground">
                        {titleWithDot(text.accountingTitle)}
                      </span>
                      <span aria-hidden className="mx-1 mb-2 h-4 w-px shrink-0 self-end bg-border" />
                      <ToolbarField label={t.dash_this_year}>
                      <Input
                        type="number"
                        min="2020"
                        max="2100"
                        value={accountingYear}
                        onChange={(event) => setAccountingYear(event.target.value || currentYear)}
                        aria-label={text.accountingTitle}
                        className={cn(shellInputClassName, "h-8 w-24 shrink-0 rounded-md bg-field text-xs")}
                      />
                      </ToolbarField>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        title={text.refreshLedger}
                        aria-label={text.refreshLedger}
                        onClick={() => setReloadToken((current) => current + 1)}
                      >
                        <RefreshCw className={cn("size-3.5", accountingBusy && "animate-spin")} />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void downloadAccountingLedgerExport(accountingYear).catch((error) =>
                            setAccountingError(
                              error instanceof Error ? error.message : t.common_error,
                            ),
                          )
                        }
                      >
                        <Download className="size-3.5" />
                        {text.exportCsv}
                      </Button>
                    </>
                  }
                  toolbarAfter={
                    <DataTablePager
                      pageIndex={accountingEntriesPagination.pageIndex}
                      pageSize={accountingEntriesPagination.pageSize}
                      totalPages={accountingEntriesPagination.totalPages}
                      totalRows={accountingEntriesPagination.totalRows}
                      previousLabel={t.pagination_previous}
                      nextLabel={t.pagination_next}
                      onPageChange={accountingEntriesPagination.onPageChange}
                    />
                  }
                  rowAccent={(row) => (row.direction === "income" ? "bg-emerald-500" : "bg-rose-500")}
                  emptyState={
                    <EmptyState
                      title={text.noAccountingEntries}
                      description={text.noAccountingEntriesDescription}
                    />
                  }
                />
              ) : null}
            </div>
            {!accountingBusy && !accountingError && accountingLedger ? (
              <section>
                  <DataTableSurface
                    toolbarStart={
                      <>
                        <span className="flex h-8 shrink-0 items-center self-end text-[13px] font-semibold tracking-tight text-foreground">
                          {titleWithDot(text.monthlyEuer)}
                        </span>
                        <span aria-hidden className="mx-1 mb-2 h-4 w-px shrink-0 self-end bg-border" />
                      </>
                    }
                    rows={accountingMonthlyPagination.pagedRows}
                    columns={accountingMonthlyTableColumns}
                    rowId={(row) => row.period}
                    defaultDensity="comfortable"
                    defaultFrozenColumns={["period"]}
                    dictionary={t as unknown as Record<string, string>}
                    groupLabels={accountingColumnGroups}
                    maxFrozenColumns={2}
                    toolbarClassName="border-b border-border/70 bg-card px-3 py-2"
                    toolbarAfter={
                      <DataTablePager
                        pageIndex={accountingMonthlyPagination.pageIndex}
                        pageSize={accountingMonthlyPagination.pageSize}
                        totalPages={accountingMonthlyPagination.totalPages}
                        totalRows={accountingMonthlyPagination.totalRows}
                        previousLabel={t.pagination_previous}
                        nextLabel={t.pagination_next}
                        onPageChange={accountingMonthlyPagination.onPageChange}
                      />
                    }
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
              </section>
            ) : null}
          </>
        ) : null}

        {optionsError ? <ShellBanner tone="error">{optionsError}</ShellBanner> : null}

        <div className="space-y-3">
          {listError ? <ShellBanner tone="error">{listError}</ShellBanner> : null}
          <DataTableSurface
            rows={invoices}
            columns={invoiceTableColumns}
            rowId={(row) => row.id}
            defaultDensity="comfortable"
            defaultFrozenColumns={INVOICE_DEFAULT_FROZEN_COLUMNS}
            dictionary={t as unknown as Record<string, string>}
            groupLabels={invoiceColumnGroups}
            loading={listBusy}
            maxFrozenColumns={INVOICE_MAX_FROZEN_COLUMNS}
            toolbarStart={
              <>
            <span className="flex h-8 shrink-0 items-center self-end text-[13px] font-semibold tracking-tight text-foreground">
              {titleWithDot(t.invoices_title)}
            </span>
            <span aria-hidden className="mx-1 mb-2 h-4 w-px shrink-0 self-end bg-border" />
            <ToolbarField label={t.common_search} className="min-w-[220px] flex-1 sm:max-w-sm">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.search}
                onChange={(event) => startTransition(() => {
                  setFilters((current) => ({ ...current, search: event.target.value }));
                  setInvoicePage(1);
                })}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setFilters((current) => ({ ...current, search: "" }));
                    setInvoicePage(1);
                    (event.target as HTMLInputElement).blur();
                  }
                }}
                className={cn(shellInputClassName, "h-8 rounded-md bg-field pl-8 text-xs")}
                placeholder={text.searchPlaceholder}
              />
            </div>
            </ToolbarField>

            <ToolbarField label={t.invoices_patient}>
            <NativeComboboxSelect
              value={filters.patientId || "__all__"}
              onChange={(event) => {
                const patientId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
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
              className={cn(selectClassName, "h-8 rounded-md w-[210px] bg-field text-xs")}
            >
              <option value="__all__">{t.invoices_patient}</option>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>
                  {`${patient.patient_id} | ${[patient.first_name, patient.last_name]
                    .filter(Boolean)
                    .join(" ")}`}
                </option>
              ))}
            </NativeComboboxSelect>
            </ToolbarField>

            <ToolbarField label={t.orders_title}>
            <NativeComboboxSelect
              value={filters.orderId || "__all__"}
              onChange={(event) => {
                const orderId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
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
              className={cn(selectClassName, "h-8 rounded-md w-[210px] bg-field text-xs")}
            >
              <option value="__all__">{text.allOrders}</option>
              {filteredOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {`${order.order_number} | ${order.patient_pid} | ${order.patient_name}`}
                </option>
              ))}
            </NativeComboboxSelect>
            </ToolbarField>

            <ToolbarField label={text.allQuotes}>
            <NativeComboboxSelect
              value={filters.quoteId || "__all__"}
              onChange={(event) => {
                const quoteId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
                setFilters((current) => ({ ...current, quoteId }));
                setInvoicePage(1);
                syncQuery({ quote: quoteId || null });
              }}
              className={cn(selectClassName, "h-8 rounded-md w-[190px] bg-field text-xs")}
            >
              <option value="__all__">{text.allQuotes}</option>
              {filteredQuotes.map((quote) => (
                <option key={quote.id} value={quote.id}>
                  {quoteOptionLabel(quote)}
                </option>
              ))}
            </NativeComboboxSelect>
            </ToolbarField>

            <ToolbarField label={t.invoices_status}>
            <NativeComboboxSelect
              value={filters.status || "__all__"}
              onChange={(event) => {
                setFilters((current) => ({
                  ...current,
                  status:
                    event.target.value && event.target.value !== "__all__"
                      ? event.target.value
                      : "",
                }));
                setInvoicePage(1);
              }}
              className={cn(selectClassName, "h-8 rounded-md w-[160px] bg-field text-xs")}
            >
              <option value="__all__">{t.invoices_status}</option>
              {INVOICE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {invoiceStatusLabel(status)}
                </option>
              ))}
            </NativeComboboxSelect>
            </ToolbarField>

            <ToolbarField label={t.invoices_type}>
            <NativeComboboxSelect
              value={filters.invoiceType || "__all__"}
              onChange={(event) => {
                setFilters((current) => ({
                  ...current,
                  invoiceType:
                    event.target.value && event.target.value !== "__all__"
                      ? event.target.value
                      : "",
                }));
                setInvoicePage(1);
              }}
              className={cn(selectClassName, "h-8 rounded-md w-[150px] bg-field text-xs")}
            >
              <option value="__all__">{t.invoices_type}</option>
              {INVOICE_TYPES.map((invoiceType) => (
                <option key={invoiceType} value={invoiceType}>
                  {invoiceTypeLabel(invoiceType)}
                </option>
              ))}
            </NativeComboboxSelect>
            </ToolbarField>

            <div className="ml-auto flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                title={text.refresh}
                aria-label={text.refresh}
                onClick={() => setReloadToken((current) => current + 1)}
              >
                <RefreshCw className={cn("size-3.5", listBusy && "animate-spin")} />
              </Button>
              {anyQuickFilterActive ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilters(DEFAULT_FILTERS);
                    setInvoicePage(1);
                    syncQuery({ patient: null, order: null, quote: null, page: null });
                  }}
                >
                  <X className="size-3.5" />
                  {t.common_reset}
                </Button>
              ) : null}
            </div>
              </>
            }
            toolbarAfter={
              <DataTablePager
                pageIndex={Math.max(0, invoicePage - 1)}
                pageSize={DEFAULT_INVOICE_PAGE_SIZE}
                totalPages={invoiceTotalPages}
                totalRows={invoiceTotal}
                previousLabel={t.pagination_previous}
                nextLabel={t.pagination_next}
                onPageChange={(pageIndex) => setInvoicePage(pageIndex + 1)}
              />
            }
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
            footer={({ filteredCount, totalCount }) => {
              const pageRowsLabel =
                filteredCount === totalCount
                  ? `${totalCount}`
                  : `${filteredCount} / ${totalCount}`;
              return `${text.pageLabel} ${invoicePage} ${text.pageOf} ${invoiceTotalPages} | ${pageRowsLabel} / ${invoiceTotal} ${text.invoiceCount}`;
            }}
          />
        </div>
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
                  submitDisabled={!createForm.quoteId || selectedCreateTotals.gross <= 0}
                  onCancel={() => setCreateOpen(false)}
                />
              )}
            >
              <div className="space-y-4 rounded-xl">
                {createError ? <ShellBanner tone="error">{createError}</ShellBanner> : null}
                <section className="rounded-lg border border-border/70 bg-card p-5">
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.createQuoteSection)}</h2>
                  <div className="mt-5 space-y-4">
                    <Field label={text.createQuoteSection}>
                      <NativeComboboxSelect
                        value={createForm.quoteId || "__empty__"}
                        onChange={(event) => {
                          const quoteId =
                            event.target.value && event.target.value !== "__empty__"
                              ? event.target.value
                              : "";
                          const quote = quotes.find((item) => item.id === quoteId);
                          setCreateForm((current) => ({
                            ...current,
                            quoteId,
                            selectedLineIndexes:
                              quote?.line_items.flatMap((line, index) =>
                                invoiceLineQuantityAvailable(line, createForm.invoiceType) > 0
                                  ? [index]
                                  : [],
                              ) ?? [],
                            lineQuantities: Object.fromEntries(
                              quote?.line_items.map((line, index) => [
                                String(index),
                                String(
                                  invoiceLineQuantityAvailable(line, createForm.invoiceType) || "1",
                                ),
                              ]) ?? [],
                            ),
                          }));
                        }}
                        className={selectClassName}
                      >
                        <option value="__empty__">{text.chooseQuote}</option>
                        {filteredQuotes.map((quote) => (
                          <option key={quote.id} value={quote.id}>
                            {quoteOptionLabel(quote)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
                    </Field>
                    <Field label={text.selectedQuoteSnapshot}>
                      <div className={cn("rounded-xl px-3 py-2 text-sm text-foreground", tokens.surface.mutedCard)}>
                        {selectedCreateQuote
                          ? `${quoteOptionLabel(selectedCreateQuote)} | ${formatMoney(selectedCreateQuote.total_gross)}`
                          : text.chooseQuote}
                      </div>
                    </Field>
                  </div>
                </section>

                {selectedCreateQuote ? (
                  <section className="rounded-lg border border-border/70 bg-card p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>
                          {titleWithDot(text.invoiceLines)}
                        </h2>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          {text.invoiceLinesDescription}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCreateForm((current) => ({
                            ...current,
                            selectedLineIndexes: selectedCreateQuote.line_items.flatMap(
                              (line, index) =>
                                invoiceLineQuantityAvailable(line, createForm.invoiceType) > 0
                                  ? [index]
                                  : [],
                            ),
                          }))
                        }
                      >
                        {text.selectAllLines}
                      </Button>
                    </div>
                    <div className="mt-4 space-y-2">
                      {selectedCreateQuote.line_items.map((line, lineIndex) => {
                        const selected = createForm.selectedLineIndexes.includes(lineIndex);
                        const availableQuantity = invoiceLineQuantityAvailable(
                          line,
                          createForm.invoiceType,
                        );
                        const fullyInvoiced = availableQuantity <= 0;
                        return (
                          <div
                            key={`${selectedCreateQuote.id}-${lineIndex}`}
                            className={cn(
                              "grid gap-3 rounded-lg border p-3 sm:grid-cols-[auto_1fr_7rem_7rem] sm:items-center",
                              selected
                                ? "border-sky-300/70 bg-sky-50/40"
                                : "border-border/70 bg-muted/20 opacity-70",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={fullyInvoiced || createForm.invoiceType === "final"}
                              aria-label={`${text.invoiceLines}: ${line.description}`}
                              onChange={(event) =>
                                setCreateForm((current) => ({
                                  ...current,
                                  selectedLineIndexes: event.target.checked
                                    ? [...current.selectedLineIndexes, lineIndex].sort((a, b) => a - b)
                                    : current.selectedLineIndexes.filter(
                                        (index) => index !== lineIndex,
                                      ),
                                }))
                              }
                              className="size-4 rounded border-border"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">
                                {agencyServiceNameLabel(undefined, line.description, t)}
                              </p>
                              {line.notes ? (
                                <p className="mt-1 whitespace-pre-line text-xs leading-5 text-muted-foreground">
                                  {line.notes}
                                </p>
                              ) : null}
                            </div>
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              max={String(availableQuantity)}
                              disabled={
                                !selected ||
                                fullyInvoiced ||
                                createForm.invoiceType === "final"
                              }
                              value={createForm.lineQuantities[String(lineIndex)] ?? ""}
                              onChange={(event) =>
                                setCreateForm((current) => ({
                                  ...current,
                                  lineQuantities: {
                                    ...current.lineQuantities,
                                    [String(lineIndex)]: event.target.value,
                                  },
                                }))
                              }
                              aria-label={`${text.quantity}: ${line.description}`}
                              className={shellInputClassName}
                            />
                            <div className="text-right text-sm tabular-nums text-foreground">
                              {formatMoney(
                                selectedCreateTotals.lineGrossByIndex[lineIndex] ?? 0,
                              )}
                              <div className="text-[11px] text-muted-foreground">
                                {line.vat_rate}% {lang === "de" ? "USt." : "НДС"}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                {selectedCreateQuote ? (
                  <section
                    className={cn(
                      "rounded-lg border p-5",
                      createForm.invoiceType === "advance"
                        ? "border-amber-300/80 bg-amber-50/70"
                        : "border-border/70 bg-card",
                    )}
                  >
                    {createForm.invoiceType === "advance" ? (
                      <div className="mb-4">
                        <h2 className={tokens.text.sectionTitle}>{text.advanceVatTitle}</h2>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          {text.advanceVatDescription}
                        </p>
                      </div>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-3">
                      <MiniMetric
                        label={text.selectionNet}
                        value={formatMoney(selectedCreateTotals.net)}
                      />
                      <MiniMetric
                        label={text.selectionVat}
                        value={formatMoney(selectedCreateTotals.vat)}
                      />
                      <MiniMetric
                        label={text.selectionGross}
                        value={formatMoney(selectedCreateTotals.gross)}
                      />
                    </div>
                  </section>
                ) : null}

                <section className="rounded-lg border border-border/70 bg-card p-5">
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.invoiceSettingsSection)}</h2>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <Field label={t.invoices_type}>
                      <NativeComboboxSelect
                        value={createForm.invoiceType}
                        onChange={(event) =>
                          setCreateForm((current) => {
                            const invoiceType = event.target.value as InvoiceType;
                            return {
                              ...current,
                              invoiceType,
                              selectedLineIndexes:
                                selectedCreateQuote?.line_items.flatMap((line, index) =>
                                  invoiceLineQuantityAvailable(line, invoiceType) > 0
                                    ? [index]
                                    : [],
                                ) ?? [],
                              lineQuantities: Object.fromEntries(
                                selectedCreateQuote?.line_items.map((line, index) => [
                                  String(index),
                                  String(invoiceLineQuantityAvailable(line, invoiceType)),
                                ]) ?? [],
                              ),
                            };
                          })
                        }
                        className={selectClassName}
                      >
                        {INVOICE_TYPES.map((invoiceType) => (
                          <option key={invoiceType} value={invoiceType}>
                            {invoiceTypeLabel(invoiceType)}
                          </option>
                        ))}
                      </NativeComboboxSelect>
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
                  </div>
                </section>

                <section className="rounded-lg border border-border/70 bg-card p-5">
                  <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.notes)}</h2>
                  <div className="mt-5">
                    <Field label={text.notes}>
                      <textarea
                        className={textareaClassName}
                        value={createForm.notes}
                        onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))}
                        placeholder={text.billingNotePlaceholder}
                      />
                    </Field>
                  </div>
                </section>
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
          setVisibilityError(null);
          setPayerError(null);
          setDetailError(null);
          setInvoicePdfPreview(null);
          syncQuery({ invoice: null }, { replace: false });
        }
      }}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <AdminSheetScaffold
            title={detail ? `${detail.invoice_number} / ${detail.patient_name}` : t.invoices_title}
            description={text.detailSheetDescription}
          >
            {detailBusy ? <LoadingState label={t.common_loading} /> : detailError ? <ShellBanner tone="error">{detailError}</ShellBanner> : !detail ? <EmptyState title={text.noInvoiceSelected} description={text.noInvoiceSelectedDescription} /> : (
              <div className="space-y-4 rounded-xl">
                <section className="rounded-lg border border-border/70 bg-card">
                  <div className="relative overflow-hidden p-3.5">
                    <span
                      className={cn(
                        "absolute left-0 top-4 h-12 w-1 rounded-r-full",
                        detail.status === "paid"
                          ? "bg-emerald-500"
                          : detail.status === "overdue"
                            ? "bg-rose-500"
                            : detail.status === "cancelled"
                              ? "bg-slate-400"
                              : "bg-sky-500",
                      )}
                    />
                    <div className="grid gap-4 pl-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="h-px w-8 bg-border" />
                          <StatusBadge tone={statusBadgeClass(detail.status)}>
                            {invoiceStatusLabel(detail.status)}
                          </StatusBadge>
                        </div>
                        <h3 className="mt-2 text-lg font-semibold leading-none text-foreground">
                          {detail.patient_name}
                        </h3>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          {[detail.invoice_number, detail.order_number, detail.quote_number]
                            .filter(Boolean)
                            .join(" - ")}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="outline" className="rounded-full">
                            {invoiceTypeLabel(detail.invoice_type)}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 border-t border-dashed border-border pt-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-700">
                          <FileText aria-hidden="true" className="size-4" />
                        </div>
                        <div className="min-w-[12rem] flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {detail.invoice_number}.pdf
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {invoiceTypeLabel(detail.invoice_type)} · PDF
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 rounded-lg"
                            disabled={invoicePdfPreviewBusy}
                            onClick={() => void handleOpenInvoicePdfPreview(detail)}
                          >
                            {invoicePdfPreviewBusy ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : (
                              <Eye className="size-3.5" />
                            )}
                            {text.previewPdf}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 rounded-lg"
                            onClick={() =>
                              void downloadInvoicePdf(
                                detail.id,
                                detail.invoice_number ? `${detail.invoice_number}.pdf` : "",
                                t.revenue_invoices_pdf_fallback_filename,
                              ).catch((error) =>
                                setDetailError(error instanceof Error ? error.message : text.pdfDownloadError),
                              )
                            }
                          >
                            <Download className="size-3.5" />
                            {text.downloadPdf}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <SectionCard
                  title={text.invoiceOverview}
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8 rounded-lg"
                      onClick={() => setStatusDialogOpen(true)}
                      disabled={!access.canManage}
                      aria-label={t.common_edit}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  }
                >
                  <div className="space-y-5">
                    <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
                      <SummaryLine label={t.invoices_patient} value={detail.patient_pid} />
                      <SummaryLine label={t.orders_title} value={detail.order_number} />
                      <SummaryLine label={text.createQuoteSection} value={detail.quote_number ?? t.common_not_set} />
                      <SummaryLine label={t.invoices_issued_at} value={formatDateTime(detail.issued_at, locale, t.common_not_set)} />
                      <SummaryLine label={t.invoices_due_at} value={formatDate(detail.due_date, locale, t.common_not_set)} />
                      <SummaryLine label={t.invoices_paid_at} value={formatDateTime(detail.paid_at, locale, t.common_not_set)} />
                      <SummaryLine label={text.grossTotal} value={formatMoney(detail.total_gross)} />
                      {Number(detail.credited_amount ?? 0) > 0 ? (
                        <SummaryLine
                          label={lang === "de" ? "Gutschriften" : "Кредит-ноты"}
                          value={`−${formatMoney(detail.credited_amount)}`}
                        />
                      ) : null}
                      {Number(detail.credited_amount ?? 0) > 0 ? (
                        <SummaryLine
                          label={lang === "de" ? "Korrigierter Betrag" : "Сумма после корректировок"}
                          value={formatMoney(detail.adjusted_total_gross ?? detail.total_gross)}
                        />
                      ) : null}
                      <SummaryLine label={t.invoices_paid} value={formatMoney(detail.paid_amount)} />
                      <SummaryLine
                        label={text.prepaymentApplied}
                        value={formatMoney(detail.prepayment_applied_amount ?? 0)}
                      />
                      <SummaryLine label={text.balanceDue} value={formatMoney(detail.balance_due)} />
                      {Number(detail.credit_balance ?? 0) > 0 ? (
                        <SummaryLine
                          label={lang === "de" ? "Guthaben des Patienten" : "Переплата пациента"}
                          value={formatMoney(detail.credit_balance)}
                        />
                      ) : null}
                    </div>
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h2 className={tokens.text.sectionTitle}>{titleWithDot(text.notes)}</h2>
                        </div>
                      </div>
                      <div className="rounded-xl border border-border bg-background/60 p-3.5 text-sm leading-snug text-muted-foreground">
                        {detail.notes || t.common_not_set}
                      </div>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title={text.payments}>
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      {text.paymentsDescription}
                    </p>

                    {access.canManage &&
                    !["draft", "cancelled"].includes(detail.status) &&
                    Number(detail.balance_due ?? 0) > 0 ? (
                      <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Field label={text.paymentAmount}>
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            max={String(detail.balance_due ?? "")}
                            value={paymentForm.amountGross}
                            onChange={(event) =>
                              setPaymentForm((current) => ({
                                ...current,
                                amountGross: event.target.value,
                              }))
                            }
                            className={shellInputClassName}
                          />
                        </Field>
                        <Field label={text.paymentMethod}>
                          <NativeComboboxSelect
                            value={paymentForm.paymentMethod}
                            onChange={(event) =>
                              setPaymentForm((current) => ({
                                ...current,
                                paymentMethod: event.target.value,
                              }))
                            }
                            className={selectClassName}
                          >
                            {[
                              "bank_transfer",
                              "card",
                              "cash",
                              "direct_debit",
                              "cheque",
                              "other",
                            ].map((method) => (
                              <option key={method} value={method}>
                                {text.paymentMethods[method]}
                              </option>
                            ))}
                          </NativeComboboxSelect>
                        </Field>
                        <Field label={text.paymentDate}>
                          <Input
                            type="date"
                            max={new Date().toISOString().slice(0, 10)}
                            value={paymentForm.receivedOn}
                            onChange={(event) =>
                              setPaymentForm((current) => ({
                                ...current,
                                receivedOn: event.target.value,
                              }))
                            }
                            className={shellInputClassName}
                          />
                        </Field>
                        <Field label={text.paymentReference}>
                          <Input
                            value={paymentForm.paymentReference}
                            onChange={(event) =>
                              setPaymentForm((current) => ({
                                ...current,
                                paymentReference: event.target.value,
                              }))
                            }
                            className={shellInputClassName}
                          />
                        </Field>
                        <Field label={text.paymentNote} className="sm:col-span-2">
                          <Input
                            value={paymentForm.note}
                            onChange={(event) =>
                              setPaymentForm((current) => ({
                                ...current,
                                note: event.target.value,
                              }))
                            }
                            className={shellInputClassName}
                          />
                        </Field>
                        <div className="flex items-end sm:col-span-2 lg:col-span-3 lg:justify-end">
                          <Button
                            type="button"
                            disabled={
                              paymentBusy ||
                              Number(paymentForm.amountGross) <= 0 ||
                              Number(paymentForm.amountGross) > Number(detail.balance_due ?? 0) ||
                              !paymentForm.receivedOn
                            }
                            onClick={() => void handleRecordPayment()}
                          >
                            {paymentBusy ? (
                              <LoaderCircle className="mr-2 size-4 animate-spin" />
                            ) : null}
                            {text.recordPayment}
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {paymentError ? (
                      <ShellBanner tone="error">{paymentError}</ShellBanner>
                    ) : null}

                    {paymentTransactions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                        {text.noPayments}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {paymentTransactions.map((payment) => {
                          const isReversal = payment.transaction_type === "reversal";
                          const canReverse =
                            access.canManage &&
                            !isReversal &&
                            !payment.is_reversed &&
                            detail.status !== "cancelled";
                          return (
                            <div
                              key={payment.id}
                              className={cn(
                                "rounded-lg border border-border/70 bg-background/70 p-3",
                                payment.is_reversed && "opacity-70",
                              )}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-foreground">
                                      {isReversal ? text.reversal : text.recordPayment}
                                    </span>
                                    {payment.is_reversed ? (
                                      <StatusBadge tone="neutral">{text.reversed}</StatusBadge>
                                    ) : null}
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {formatDate(payment.received_on, locale, t.common_not_set)} · {text.paymentMethods[payment.payment_method] ?? payment.payment_method}
                                    {payment.payment_reference
                                      ? ` · ${payment.payment_reference}`
                                      : ""}
                                  </div>
                                  {payment.note ? (
                                    <div className="mt-2 text-xs text-muted-foreground">
                                      {payment.note}
                                    </div>
                                  ) : null}
                                  {payment.created_by_name ? (
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      {payment.created_by_name}
                                    </div>
                                  ) : null}
                                </div>
                                <div className="text-right">
                                  <div
                                    className={cn(
                                      "font-mono font-semibold tabular-nums",
                                      isReversal ? "text-rose-700" : "text-emerald-700",
                                    )}
                                  >
                                    {isReversal ? "−" : "+"}
                                    {formatMoney(payment.amount_gross)}
                                  </div>
                                  {canReverse ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="mt-1 h-7 px-2 text-xs"
                                      onClick={() => {
                                        setReversingPaymentId(payment.id);
                                        setReversalNote("");
                                      }}
                                    >
                                      {text.reversePayment}
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                              {reversingPaymentId === payment.id ? (
                                <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row">
                                  <Input
                                    value={reversalNote}
                                    onChange={(event) => setReversalNote(event.target.value)}
                                    placeholder={text.reversalReason}
                                    className={shellInputClassName}
                                  />
                                  <div className="flex gap-2">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      onClick={() => {
                                        setReversingPaymentId("");
                                        setReversalNote("");
                                      }}
                                    >
                                      {t.common_cancel}
                                    </Button>
                                    <Button
                                      type="button"
                                      disabled={paymentBusy || !reversalNote.trim()}
                                      onClick={() => void handleReversePayment(payment.id)}
                                    >
                                      {text.reversePayment}
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </SectionCard>

                <SectionCard title={lang === "de" ? "Gutschriften" : "Кредит-ноты"}>
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      {lang === "de"
                        ? "Rechnungskorrekturen werden dauerhaft protokolliert. Eine falsche Gutschrift wird storniert, nicht gelöscht."
                        : "Корректировки счета сохраняются в журнале. Ошибочная кредит-нота отменяется, а не удаляется."}
                    </p>
                    {access.canManage && !["draft", "cancelled"].includes(detail.status) && Number(detail.adjusted_total_gross ?? detail.total_gross) > 0 ? (
                      <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Field label={lang === "de" ? "Bruttobetrag" : "Сумма брутто"}>
                          <Input
                            type="number"
                            min="0.01"
                            step="0.01"
                            max={String(detail.adjusted_total_gross ?? detail.total_gross)}
                            value={creditNoteForm.amountGross}
                            onChange={(event) => setCreditNoteForm((current) => ({ ...current, amountGross: event.target.value }))}
                            className={shellInputClassName}
                          />
                        </Field>
                        <Field label={lang === "de" ? "Datum" : "Дата"}>
                          <Input
                            type="date"
                            min={detail.issued_at.slice(0, 10)}
                            max={new Date().toISOString().slice(0, 10)}
                            value={creditNoteForm.issuedOn}
                            onChange={(event) => setCreditNoteForm((current) => ({ ...current, issuedOn: event.target.value }))}
                            className={shellInputClassName}
                          />
                        </Field>
                        <Field label={lang === "de" ? "Grund" : "Причина"} className="sm:col-span-2 lg:col-span-1">
                          <Input
                            value={creditNoteForm.reason}
                            onChange={(event) => setCreditNoteForm((current) => ({ ...current, reason: event.target.value }))}
                            className={shellInputClassName}
                          />
                        </Field>
                        <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
                          <input
                            type="checkbox"
                            checked={creditNoteForm.portalVisible}
                            onChange={(event) => setCreditNoteForm((current) => ({ ...current, portalVisible: event.target.checked }))}
                          />
                          {lang === "de" ? "Im Patientenportal anzeigen" : "Показывать в портале пациента"}
                        </label>
                        <div className="flex items-end lg:justify-end">
                          <Button
                            type="button"
                            disabled={creditNoteBusy || Number(creditNoteForm.amountGross) <= 0 || Number(creditNoteForm.amountGross) > Number(detail.adjusted_total_gross ?? detail.total_gross) || !creditNoteForm.reason.trim() || !creditNoteForm.issuedOn}
                            onClick={() => void handleCreateCreditNote()}
                          >
                            {creditNoteBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                            {lang === "de" ? "Gutschrift erstellen" : "Создать кредит-ноту"}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {creditNoteError ? <ShellBanner tone="error">{creditNoteError}</ShellBanner> : null}
                    {creditNoteTransactions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                        {lang === "de" ? "Keine Gutschriften." : "Кредит-нот пока нет."}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {creditNoteTransactions.map((credit) => {
                          const isReversal = credit.transaction_type === "reversal";
                          const canReverse = access.canManage && !isReversal && !credit.is_reversed && detail.status !== "cancelled";
                          return (
                            <div key={credit.id} className={cn("rounded-lg border border-border/70 bg-background/70 p-3", credit.is_reversed && "opacity-70")}>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-foreground">{credit.document_number}</span>
                                    {credit.is_reversed ? <StatusBadge tone="neutral">{text.reversed}</StatusBadge> : null}
                                  </div>
                                  <div className="mt-1 text-xs text-muted-foreground">{formatDate(credit.issued_on, locale, t.common_not_set)} · {credit.reason}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {credit.portal_visible ? (lang === "de" ? "Im Portal sichtbar" : "Видно в портале") : (lang === "de" ? "Nur intern" : "Только для сотрудников")}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className={cn("font-mono font-semibold tabular-nums", isReversal ? "text-foreground" : "text-emerald-700")}>{isReversal ? "+" : "−"}{formatMoney(credit.amount_gross)}</div>
                                  {canReverse ? (
                                    <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs" onClick={() => { setReversingCreditNoteId(credit.id); setCreditNoteReversalReason(""); }}>
                                      {lang === "de" ? "Stornieren" : "Отменить"}
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                              {reversingCreditNoteId === credit.id ? (
                                <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row">
                                  <Input value={creditNoteReversalReason} onChange={(event) => setCreditNoteReversalReason(event.target.value)} placeholder={lang === "de" ? "Stornogrund" : "Причина отмены"} className={shellInputClassName} />
                                  <div className="flex gap-2">
                                    <Button type="button" variant="outline" onClick={() => { setReversingCreditNoteId(""); setCreditNoteReversalReason(""); }}>{t.common_cancel}</Button>
                                    <Button type="button" disabled={creditNoteBusy || !creditNoteReversalReason.trim()} onClick={() => void handleReverseCreditNote(credit.id)}>{lang === "de" ? "Stornieren" : "Отменить"}</Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </SectionCard>

                {detail.invoice_type !== "advance" &&
                ((detail.available_prepayments?.length ?? 0) > 0 ||
                  (detail.prepayment_allocations?.length ?? 0) > 0) ? (
                  <SectionCard title={text.prepayment}>
                    <div className="space-y-4">
                      {(detail.prepayment_allocations?.length ?? 0) > 0 ? (
                        <div className="space-y-2">
                          {detail.prepayment_allocations?.map((allocation) => (
                            <div
                              key={allocation.id}
                              className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm"
                            >
                              <span className="text-muted-foreground">
                                {allocation.advance_invoice_number}
                              </span>
                              <span className="font-mono font-semibold tabular-nums text-foreground">
                                {formatMoney(allocation.amount_gross)}
                              </span>
                              {access.canManage ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-7 rounded-md"
                                  disabled={prepaymentBusy}
                                  onClick={() =>
                                    void handleReleasePrepayment(allocation.id)
                                  }
                                  aria-label={
                                    lang === "de"
                                      ? "Vorauszahlung entfernen"
                                      : "Убрать предоплату"
                                  }
                                >
                                  <X className="size-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {(detail.available_prepayments?.length ?? 0) > 0 && access.canManage ? (
                        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
                          <Field label={text.availableAdvance}>
                            <NativeComboboxSelect
                              value={prepaymentInvoiceId}
                              onChange={(event) => {
                                const invoiceId = event.target.value;
                                const advance = detail.available_prepayments?.find(
                                  (item) => item.invoice_id === invoiceId,
                                );
                                setPrepaymentInvoiceId(invoiceId);
                                setPrepaymentAmount(
                                  advance
                                    ? cappedPrepaymentAmount(
                                        advance.available_amount,
                                        detail.balance_due,
                                      )
                                    : "",
                                );
                              }}
                              className={selectClassName}
                            >
                              {detail.available_prepayments?.map((advance) => (
                                <option key={advance.invoice_id} value={advance.invoice_id}>
                                  {advance.invoice_number} · {formatMoney(advance.available_amount)}
                                </option>
                              ))}
                            </NativeComboboxSelect>
                          </Field>
                          <Field label={text.amountToApply}>
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              max={cappedPrepaymentAmount(
                                detail.available_prepayments?.find(
                                  (item) => item.invoice_id === prepaymentInvoiceId,
                                )?.available_amount,
                                detail.balance_due,
                              )}
                              value={prepaymentAmount}
                              onChange={(event) => setPrepaymentAmount(event.target.value)}
                              className={shellInputClassName}
                            />
                          </Field>
                          <Button
                            type="button"
                            disabled={
                              prepaymentBusy ||
                              !prepaymentInvoiceId ||
                              Number(prepaymentAmount) <= 0
                            }
                            onClick={() => void handleApplyPrepayment()}
                          >
                            {prepaymentBusy ? (
                              <LoaderCircle className="mr-2 size-4 animate-spin" />
                            ) : null}
                            {text.applyPrepayment}
                          </Button>
                        </div>
                      ) : null}
                      {prepaymentError ? (
                        <ShellBanner tone="error">{prepaymentError}</ShellBanner>
                      ) : null}
                    </div>
                  </SectionCard>
                ) : null}

                <SectionCard title={t.providers_linked_patients}>
                  <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
                    {[
                      {
                        key: "patient",
                        label: t.invoices_patient,
                        description: text.linkedPatientCardDescription,
                        href: `/patients?patient=${detail.patient_id}`,
                      },
                      {
                        key: "order",
                        label: text.linkedOrder,
                        description: text.linkedOrderCardDescription,
                        href: `/orders?order=${detail.order_id}&patient=${detail.patient_id}`,
                      },
                      {
                        key: "quotes",
                        label: text.quotes,
                        description: text.linkedQuoteCardDescription,
                        href: `/contracts?quote=${detail.quote_id ?? ""}&order=${detail.order_id}&patient=${detail.patient_id}&tab=quotes`,
                      },
                      {
                        key: "documents",
                        label: t.nav_documents,
                        description: text.linkedDocumentsCardDescription ?? text.linkedOrderDocument,
                        href: `/documents?order=${detail.order_id}&patient=${detail.patient_id}`,
                      },
                    ].map((link) => (
                      <button
                        key={link.key}
                        type="button"
                        className="group flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/20"
                        onClick={() => window.open(link.href, "_blank", "noopener,noreferrer")}
                      >
                        <span className="min-w-0 shrink-0 truncate text-xs font-semibold text-foreground">
                          {link.label}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
                          {link.description}
                        </span>
                        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-orange-700" />
                      </button>
                    ))}
                  </div>
                </SectionCard>

                <div className="space-y-4">
                    <section className="relative rounded-lg border border-border/70 bg-card p-6">
                      <h2 className={tokens.text.sectionTitle}>
                        {titleWithDot(t.revenue_invoices_patient_preview)}
                      </h2>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="absolute right-4 top-4 size-8 rounded-lg"
                        onClick={() => setVisibilityDialogOpen(true)}
                        disabled={!access.canManage}
                        aria-label={t.common_edit}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <div className="mt-5 grid gap-1.5 md:grid-cols-2">
                        <MiniMetric
                          label={t.revenue_invoices_preview_portal}
                          value={
                            detail.portal_visibility?.visible_to_patient
                              ? t.revenue_invoices_visible
                              : t.revenue_invoices_hidden_from_patient
                          }
                        />
                        <MiniMetric
                          label={t.revenue_invoices_preview_amounts}
                          value={
                            detail.portal_visibility?.amounts_visible_to_patient
                              ? formatMoney(detail.total_gross)
                              : t.revenue_invoices_hidden_from_patient
                          }
                        />
                        <MiniMetric
                          label={t.revenue_invoices_preview_lines}
                          value={
                            detail.portal_visibility?.line_items_visible_to_patient
                              ? t.revenue_invoices_line_count_visible.replace(
                                  "{count}",
                                  String(detail.line_items?.length ?? 0),
                                )
                              : t.revenue_invoices_hidden_from_patient
                          }
                        />
                        <MiniMetric
                          label={t.revenue_invoices_preview_pdf}
                          value={
                            detail.portal_visibility?.pdf_visible_to_patient
                              ? t.revenue_invoices_pdf_available
                              : t.revenue_invoices_pdf_blocked
                          }
                        />
                      </div>
                      {detail.portal_visibility?.redaction_reason ? (
                        <div className="mt-4">
                          <StatusBadge tone="warning">
                            {redactionReasonLabel(detail.portal_visibility.redaction_reason)}
                          </StatusBadge>
                        </div>
                      ) : null}
                    </section>

                    <section className="relative rounded-lg border border-border/70 bg-card p-6">
                      <h2 className={tokens.text.sectionTitle}>
                        {titleWithDot(t.revenue_invoices_current_payer)}
                      </h2>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="absolute right-4 top-4 size-8 rounded-lg"
                        onClick={() => setPayerDialogOpen(true)}
                        disabled={!access.canManage}
                        aria-label={t.common_edit}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <div className="mt-5 grid gap-1.5 md:grid-cols-2">
                        <MiniMetric
                          label={t.revenue_invoices_contact_name}
                          value={
                            detail.payer?.contact_name ??
                            detail.payer?.relation_patient_name ??
                            t.common_not_set
                          }
                        />
                        <MiniMetric
                          label={t.revenue_invoices_relationship}
                          value={
                            detail.payer?.contact_relationship ??
                            detail.payer?.relation_type ??
                            t.common_not_set
                          }
                        />
                        <MiniMetric
                          label={t.revenue_invoices_email}
                          value={detail.payer?.contact_email ?? t.common_not_set}
                        />
                        <MiniMetric
                          label={t.revenue_invoices_phone}
                          value={detail.payer?.contact_phone ?? t.common_not_set}
                        />
                      </div>
                    </section>
                  </div>

                {dunningError ? <ShellBanner tone="error">{dunningError}</ShellBanner> : null}
                <DataTableSurface
                  rows={dunningEvents}
                  columns={
                    [
                      {
                        id: "level",
                        label: text.dunningTitle,
                        accessor: (event) => dunningLevelLabel(event.level),
                        sortable: true,
                        required: true,
                        width: 190,
                        render: (event) => (
                          <StatusBadge tone={dunningLevelTone(event.level)}>
                            {dunningLevelLabel(event.level)}
                          </StatusBadge>
                        ),
                      },
                      {
                        id: "sent_at",
                        label: t.appointments_date,
                        accessor: (event) => event.sent_at ?? "",
                        filterType: "date",
                        sortable: true,
                        width: 170,
                        render: (event) => (
                          <span className="whitespace-nowrap font-mono text-xs tabular-nums text-foreground">
                            {formatDateTime(event.sent_at, locale, t.common_not_set)}
                          </span>
                        ),
                      },
                      {
                        id: "balance_due",
                        label: text.dunningBalanceDue,
                        accessor: (event) => Number(event.balance_due),
                        sortable: true,
                        width: 140,
                        render: (event) => (
                          <span className="block text-right font-mono text-xs font-semibold tabular-nums text-foreground">
                            {formatMoney(event.balance_due)}
                          </span>
                        ),
                      },
                      {
                        id: "responsible",
                        label: text.dunningResponsible,
                        accessor: (event) => event.created_by_name ?? text.system,
                        sortable: true,
                        width: 200,
                        render: (event) => (
                          <span className="block truncate font-mono text-xs text-foreground">
                            {event.created_by_name ?? text.system}
                          </span>
                        ),
                      },
                      {
                        id: "note",
                        label: text.dunningNote,
                        accessor: (event) => event.note ?? "",
                        searchable: true,
                        width: 320,
                        render: (event) => (
                          <span
                            className="block truncate text-xs text-foreground"
                            title={event.note ?? undefined}
                          >
                            {event.note?.trim() || t.common_not_set}
                          </span>
                        ),
                      },
                    ] satisfies ColumnDef<(typeof dunningEvents)[number]>[]
                  }
                  rowId={(event) => event.id}
                  dictionary={t as unknown as Record<string, string>}
                  emptyState={
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {text.noDunningEvents}
                    </div>
                  }
                  toolbarStart={
                    <>
                      <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                        {text.dunningTitle}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 shrink-0 self-center rounded-lg"
                        onClick={() => setDunningDialogOpen(true)}
                        disabled={!access.canManage || !nextDunning}
                      >
                        {nextDunning ? text.createDunning : text.noFurtherEscalation}
                      </Button>
                      <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
                    </>
                  }
                />

                {!detail.line_items || detail.line_items.length === 0 ? (
                  <SectionCard title={text.lineItems}>
                    <EmptyState title={text.noLineItems} description={text.noLineItemsDescription} />
                  </SectionCard>
                ) : (
                  <DataTableSurface
                    rows={detail.line_items.map((line, index) => ({ line, index }))}
                    columns={
                      [
                        {
                          id: "num",
                          label: "#",
                          accessor: (row) => row.index + 1,
                          sortable: true,
                          required: true,
                          width: 56,
                          render: (row) => (
                            <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                              {row.index + 1}
                            </span>
                          ),
                        },
                        {
                          id: "description",
                          label: text.lineItems,
                          accessor: (row) =>
                            agencyServiceNameLabel(undefined, row.line.description, t),
                          sortable: true,
                          searchable: true,
                          required: true,
                          width: 260,
                          render: (row) => {
                            const lineDescription = agencyServiceNameLabel(
                              undefined,
                              row.line.description,
                              t,
                            );
                            return (
                              <div
                                className="min-w-0"
                                title={row.line.vat_source_explanation ?? undefined}
                              >
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span
                                    className="truncate text-xs font-medium text-foreground"
                                    title={lineDescription}
                                  >
                                    {lineDescription}
                                  </span>
                                  <span className="shrink-0 rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                                    {taxProfileLabel(
                                      row.line.tax_profile_name,
                                      row.line.tax_profile_key,
                                      row.line.vat_source,
                                    )}
                                  </span>
                                  {row.line.is_cost_passthrough ? (
                                    <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-700">
                                      {t.orders_cost_pass_through_badge}
                                    </span>
                                  ) : null}
                                </span>
                                {row.line.notes ? (
                                  <span
                                    className="block truncate text-[11px] text-muted-foreground"
                                    title={row.line.notes}
                                  >
                                    {row.line.notes}
                                  </span>
                                ) : null}
                              </div>
                            );
                          },
                        },
                        {
                          id: "vat_rate",
                          label: `${t.invoices_vat} %`,
                          accessor: (row) => row.line.vat_rate,
                          sortable: true,
                          width: 90,
                          render: (row) => (
                            <span className="block text-right font-mono text-xs tabular-nums text-foreground">
                              {row.line.vat_rate}%
                            </span>
                          ),
                        },
                        {
                          id: "net",
                          label: text.net,
                          accessor: (row) => Number(row.line.line_net),
                          sortable: true,
                          width: 110,
                          render: (row) => (
                            <span className="block text-right font-mono text-xs tabular-nums text-foreground">
                              {formatMoney(row.line.line_net)}
                            </span>
                          ),
                        },
                        {
                          id: "vat",
                          label: t.invoices_vat,
                          accessor: (row) => Number(row.line.line_vat),
                          sortable: true,
                          width: 110,
                          render: (row) => (
                            <span className="block text-right font-mono text-xs tabular-nums text-foreground">
                              {formatMoney(row.line.line_vat)}
                            </span>
                          ),
                        },
                        {
                          id: "gross",
                          label: text.gross,
                          accessor: (row) => Number(row.line.line_gross),
                          sortable: true,
                          width: 120,
                          render: (row) => (
                            <span className="block text-right font-mono text-xs font-semibold tabular-nums text-foreground">
                              {formatMoney(row.line.line_gross)}
                            </span>
                          ),
                        },
                      ] satisfies ColumnDef<{ line: InvoiceLineItem; index: number }>[]
                    }
                    rowId={(row) => String(row.index)}
                    dictionary={t as unknown as Record<string, string>}
                    toolbarStart={
                      <>
                        <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
                          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                          {text.lineItems}
                        </span>
                        <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
                      </>
                    }
                  />
                )}

                <DataTableSurface
                  rows={detail.supporting_documents ?? []}
                  columns={
                    [
                      {
                        id: "name",
                        label: t.users_name,
                        accessor: (document) =>
                          document.auto_name || document.original_filename || document.id,
                        sortable: true,
                        searchable: true,
                        required: true,
                        width: 300,
                        render: (document) => (
                          <span className="flex min-w-0 items-center gap-2">
                            <FileText className="size-3.5 shrink-0 text-orange-600" />
                            <span className="truncate font-mono text-xs font-medium text-foreground">
                              {document.auto_name || document.original_filename || document.id}
                            </span>
                          </span>
                        ),
                      },
                      {
                        id: "art",
                        label: t.providers_type,
                        accessor: (document) => document.art ?? "",
                        sortable: true,
                        width: 170,
                        render: (document) =>
                          document.art ? (
                            <span className="inline-flex rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
                              {document.art}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t.common_not_set}</span>
                          ),
                      },
                      {
                        id: "category",
                        label: t.documents_category,
                        accessor: (document) => document.category ?? "",
                        sortable: true,
                        width: 180,
                        render: (document) =>
                          document.category ? (
                            <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-mono text-[10px] font-medium text-sky-700">
                              {document.category}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t.common_not_set}</span>
                          ),
                      },
                      {
                        id: "file",
                        label: text.linkedOrderDocument,
                        accessor: (document) => document.original_filename ?? "",
                        searchable: true,
                        width: 280,
                        render: (document) => (
                          <span
                            className="block truncate font-mono text-xs text-foreground"
                            title={document.original_filename ?? undefined}
                          >
                            {document.original_filename || text.linkedOrderDocument}
                          </span>
                        ),
                      },
                    ] satisfies ColumnDef<
                      NonNullable<typeof detail.supporting_documents>[number]
                    >[]
                  }
                  rowId={(document) => document.id}
                  dictionary={t as unknown as Record<string, string>}
                  onRowClick={() =>
                    window.open(
                      `/documents?order=${detail.order_id}&patient=${detail.patient_id}`,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                  emptyState={
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                      {text.noSupportingDocuments}
                    </div>
                  }
                  toolbarStart={
                    <>
                      <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                        {text.supportingDocuments}
                      </span>
                      <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
                    </>
                  }
                />
              </div>
            )}
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>

      <Dialog
        open={Boolean(invoicePdfPreview)}
        onOpenChange={(open) => {
          if (!open) setInvoicePdfPreview(null);
        }}
      >
        <DialogContent className="flex h-[90vh] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 duration-0 data-closed:animate-none data-open:animate-none sm:h-[min(88vh,52rem)] sm:w-[min(96vw,84rem)] sm:max-w-[84rem]">
          <DialogHeader className="border-b border-border px-4 py-3 pr-14 sm:px-5 sm:pr-14">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="truncate text-base">
                  {invoicePdfPreview?.title ?? text.previewPdf}
                </DialogTitle>
                <DialogDescription className="truncate">
                  application/pdf
                </DialogDescription>
              </div>
              {detail ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 rounded-lg"
                  onClick={() =>
                    void downloadInvoicePdf(
                      detail.id,
                      detail.invoice_number ? `${detail.invoice_number}.pdf` : "",
                      t.revenue_invoices_pdf_fallback_filename,
                    ).catch((error) =>
                      setDetailError(
                        error instanceof Error ? error.message : text.pdfDownloadError,
                      ),
                    )
                  }
                >
                  <Download className="size-3.5" />
                  {text.downloadPdf}
                </Button>
              ) : null}
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 bg-slate-50 p-3">
            {invoicePdfPreview ? (
              <iframe
                title={invoicePdfPreview.title}
                src={invoicePdfPreview.url}
                className="h-full min-h-[32rem] w-full rounded-lg border border-border bg-white"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dunningDialogOpen} onOpenChange={setDunningDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle>{text.nextEscalation}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 rounded-xl p-4">
              {dunningError ? <ShellBanner tone="error">{dunningError}</ShellBanner> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">{text.nextEscalation}</div>
                  <div className="mt-1">
                    <StatusBadge tone={nextDunning ? dunningLevelTone(nextDunning) : "neutral"}>
                      {nextDunning ? dunningLevelLabel(nextDunning) : text.completed}
                    </StatusBadge>
                  </div>
                </div>
                <div className="rounded-lg border border-border/70 bg-card px-4 py-3">
                  <div className="text-xs text-muted-foreground">{text.balancePrefix}</div>
                  <div className="mt-1 text-lg font-semibold leading-none text-foreground">
                    {detail ? formatMoney(detail.balance_due) : t.common_not_set}
                  </div>
                </div>
              </div>
              <Field label={text.dunningNote}>
                <textarea
                  className={textareaClassName}
                  value={dunningForm.note}
                  onChange={(event) => setDunningForm({ note: event.target.value })}
                  disabled={!access.canManage || !nextDunning}
                  placeholder={text.dunningPlaceholder}
                />
              </Field>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={dunningBusy || !access.canManage || !nextDunning}
                  onClick={() => void handleCreateDunning()}
                >
                  {dunningBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                  {nextDunning ? text.createDunning : text.noFurtherEscalation}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle>{t.invoices_status}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 rounded-xl p-4">
              {statusError ? <ShellBanner tone="error">{statusError}</ShellBanner> : null}
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label={t.users_status}>
                  <NativeComboboxSelect
                    value={statusForm.status}
                    onChange={(event) =>
                      setStatusForm((current) => ({
                        ...current,
                        status: event.target.value as InvoiceStatus,
                      }))
                    }
                    className={selectClassName}
                    disabled={!access.canManage}
                  >
                    {INVOICE_STATUSES.map((status) => (
                      <option
                        key={status}
                        value={status}
                        disabled={["paid", "partially_paid"].includes(status)}
                      >
                        {invoiceStatusLabel(status)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </Field>
                <Field label={t.invoices_due_at}>
                  <Input
                    type="date"
                    className={shellInputClassName}
                    value={statusForm.dueDate}
                    onChange={(event) =>
                      setStatusForm((current) => ({ ...current, dueDate: event.target.value }))
                    }
                    disabled={!access.canManage}
                  />
                </Field>
                <Field label={text.notes} className="lg:col-span-2">
                  <textarea
                    className={textareaClassName}
                    value={statusForm.notes}
                    onChange={(event) =>
                      setStatusForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    disabled={!access.canManage}
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={statusBusy || !access.canManage}
                  onClick={() => void handleSaveStatus()}
                >
                  {statusBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                  {text.saveInvoice}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={visibilityDialogOpen} onOpenChange={setVisibilityDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle>{t.revenue_invoices_patient_preview}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 rounded-xl p-4">
              {visibilityError ? <ShellBanner tone="error">{visibilityError}</ShellBanner> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-1.5 rounded-md bg-card py-0.5 pr-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={visibilityForm.portalVisible}
                    onChange={(event) =>
                      setVisibilityForm((current) => ({
                        ...current,
                        portalVisible: event.target.checked,
                      }))
                    }
                    disabled={!access.canManage || visibilityBusy}
                  />
                  {t.revenue_invoices_portal_visible}
                </label>
                <label className="flex items-center gap-1.5 rounded-md bg-card py-0.5 pr-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={visibilityForm.hideAmountsFromPatient}
                    onChange={(event) =>
                      setVisibilityForm((current) => ({
                        ...current,
                        hideAmountsFromPatient: event.target.checked,
                        lineItemsVisibleToPatient: event.target.checked
                          ? false
                          : current.lineItemsVisibleToPatient,
                        pdfVisibleToPatient: event.target.checked
                          ? false
                          : current.pdfVisibleToPatient,
                      }))
                    }
                    disabled={!access.canManage || visibilityBusy}
                  />
                  {t.revenue_invoices_hide_amounts}
                </label>
                <label className="flex items-center gap-1.5 rounded-md bg-card py-0.5 pr-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={visibilityForm.lineItemsVisibleToPatient}
                    onChange={(event) =>
                      setVisibilityForm((current) => ({
                        ...current,
                        lineItemsVisibleToPatient: event.target.checked,
                      }))
                    }
                    disabled={
                      !access.canManage ||
                      visibilityBusy ||
                      visibilityForm.hideAmountsFromPatient ||
                      !visibilityForm.portalVisible
                    }
                  />
                  {t.revenue_invoices_patient_sees_lines}
                </label>
                <label className="flex items-center gap-1.5 rounded-md bg-card py-0.5 pr-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={visibilityForm.pdfVisibleToPatient}
                    onChange={(event) =>
                      setVisibilityForm((current) => ({
                        ...current,
                        pdfVisibleToPatient: event.target.checked,
                      }))
                    }
                    disabled={
                      !access.canManage ||
                      visibilityBusy ||
                      visibilityForm.hideAmountsFromPatient ||
                      !visibilityForm.portalVisible
                    }
                  />
                  {t.revenue_invoices_patient_pdf_available}
                </label>
                <Field label={t.revenue_invoices_visibility_note} className="sm:col-span-2 mt-2">
                  <textarea
                    className={textareaClassName}
                    value={visibilityForm.visibilityNote}
                    onChange={(event) =>
                      setVisibilityForm((current) => ({
                        ...current,
                        visibilityNote: event.target.value,
                      }))
                    }
                    disabled={!access.canManage || visibilityBusy}
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={visibilityBusy || !access.canManage}
                  onClick={() => void handleSaveVisibility()}
                >
                  {visibilityBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                  {t.revenue_invoices_save_visibility}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={payerDialogOpen} onOpenChange={setPayerDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <div className="space-y-5">
            <DialogHeader>
              <DialogTitle>{t.revenue_invoices_current_payer}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 rounded-xl p-4">
              {payerError ? <ShellBanner tone="error">{payerError}</ShellBanner> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t.revenue_invoices_payer_relation_id}>
                  <Input
                    className={shellInputClassName}
                    value={payerForm.payerPatientRelationId}
                    onChange={(event) =>
                      setPayerForm((current) => ({
                        ...current,
                        payerPatientRelationId: event.target.value,
                      }))
                    }
                    disabled={!access.canManage || payerBusy}
                    placeholder={t.revenue_invoices_optional_uuid}
                  />
                </Field>
                <Field label={t.revenue_invoices_contact_name}>
                  <Input
                    className={shellInputClassName}
                    value={payerForm.contactName}
                    onChange={(event) =>
                      setPayerForm((current) => ({
                        ...current,
                        contactName: event.target.value,
                      }))
                    }
                    disabled={!access.canManage || payerBusy}
                  />
                </Field>
                <Field label={t.revenue_invoices_email}>
                  <Input
                    className={shellInputClassName}
                    value={payerForm.contactEmail}
                    onChange={(event) =>
                      setPayerForm((current) => ({
                        ...current,
                        contactEmail: event.target.value,
                      }))
                    }
                    disabled={!access.canManage || payerBusy}
                  />
                </Field>
                <Field label={t.revenue_invoices_phone}>
                  <Input
                    className={shellInputClassName}
                    value={payerForm.contactPhone}
                    onChange={(event) =>
                      setPayerForm((current) => ({
                        ...current,
                        contactPhone: event.target.value,
                      }))
                    }
                    disabled={!access.canManage || payerBusy}
                  />
                </Field>
                <Field label={t.revenue_invoices_relationship}>
                  <Input
                    className={shellInputClassName}
                    value={payerForm.contactRelationship}
                    onChange={(event) =>
                      setPayerForm((current) => ({
                        ...current,
                        contactRelationship: event.target.value,
                      }))
                    }
                    disabled={!access.canManage || payerBusy}
                  />
                </Field>
                <Field label={t.revenue_invoices_payer_notes} className="sm:col-span-2">
                  <textarea
                    className={textareaClassName}
                    value={payerForm.notes}
                    onChange={(event) =>
                      setPayerForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    disabled={!access.canManage || payerBusy}
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={payerBusy || !access.canManage}
                  onClick={() => void handleSavePayer()}
                >
                  {payerBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                  {t.revenue_invoices_save_payer}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StaffInvoicesPage(...args: Parameters<typeof useStaffInvoicesPageContent>) {
  return useStaffInvoicesPageContent(...args);
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
    <section className="rounded-lg border border-border/70 bg-card p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className={tokens.text.sectionTitle}>{titleWithDot(title)}</h2>
          {description ? <p className={tokens.text.muted}>{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-[210px] flex-1 items-center justify-between gap-3 rounded-full border border-border bg-muted/20 px-4 py-2">
      <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{label}</span>
      <span className="shrink-0 text-sm font-semibold leading-none text-foreground">{value}</span>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg py-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="h-px min-w-6 flex-1 bg-border/70" />
      <span className="max-w-[48%] text-right text-sm font-semibold leading-tight text-foreground">{value}</span>
    </div>
  );
}

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
      <span>{title}</span>
    </span>
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
