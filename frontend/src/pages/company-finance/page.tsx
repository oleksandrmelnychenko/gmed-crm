import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Building2,
  Eye,
  Landmark,
  LoaderCircle,
  ReceiptText,
  Search,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { ToolbarField } from "@/components/data-table/toolbar-field";
import type { ColumnDef } from "@/components/data-table/types";
import { Input } from "@/components/ui/input";
import { StaffLink } from "@/components/staff-link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Banner as ShellBanner,
  PageHeader,
  selectClass as shellSelectClassName,
} from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { openDocumentPreview } from "@/pages/documents/data/document-api";

import { CompanyAccountsWorkspace } from "./accounts-workspace";
import { ConciergeExpenseReviewPanel } from "./concierge-expense-review-panel";
import { ProviderSettlementDialog } from "./provider-settlement-dialog";
import { ProviderStatementDialog } from "./provider-statement-dialog";
import { useFinanceAutoRefresh } from "./use-finance-auto-refresh";
import { filterPatientPositions, filterProviderDocuments, filterProviderPositions, providerDisplayName, providerGroupKey, type PatientSideFilter, type ProviderSettlementFilter } from "./table-model";
import {
  assignAccountingEntryFinancialAccount,
  fetchCompanyFinancialAccounts,
  fetchCompanyFinancialPosition,
} from "./data";
import type {
  CompanyFinancialAccountsPayload,
  CompanyFinancialFilters,
  CompanyFinancialPosition,
  CompanyCashMovement,
  CompanyPatientPosition,
  CompanyProviderLiability,
  CompanyProviderPosition,
} from "./types";

type ProviderView = "providers" | "documents";

const today = new Date();
const initialFilters: CompanyFinancialFilters = {
  from: `${today.getFullYear()}-01-01`,
  to: today.toISOString().slice(0, 10),
  currency: "",
  movement: "all",
  search: "",
};

const textByLanguage = {
  ru: {
    title: "Баланс компании",
    subtitle: "Финансовая позиция, обязательства и движение средств компании",
    searchLabel: "Поиск",
    from: "Денежные операции с",
    to: "по",
    currency: "Валюта",
    movement: "Движение",
    allMovements: "Все движения",
    inflow: "Поступления",
    outflow: "Выплаты",
    search: "Поиск по документу, пациенту или описанию",
    patientReceivables: "Долг пациентов",
    patientCredits: "Переплаты пациентов",
    providerPayables: "Долг поставщикам",
    expectedCosts: "Ожидаемые расходы",
    calculatedPosition: "Расчетная позиция",
    confirmedPosition: "Подтвержденная позиция",
    cashInflow: "Поступило за период",
    cashOutflow: "Выплачено за период",
    netCashFlow: "Денежный поток",
    actualCashBalance: "Фактический остаток",
    reconciliationRequired: "Требуется сверка",
    reconciliationMessage: (count: number, amount: string) =>
      `Нужно сверить ${count} пациентских балансов. Нераспределенные расходы: ${amount}.`,
    patients: "Пациенты",
    providers: "Поставщики",
    cash: "Движение денег",
    financialAccounts: "Счета GMED",
    conciergeExpenses: "Расходы Concierge",
    financialAccount: "Счет GMED",
    unassignedAccount: "Не распределено",
    assignmentFailed: "Не удалось изменить счет денежной операции.",
    all: "Все",
    debit: "Долг",
    credit: "Переплата",
    reconciliation: "Сверка",
    patient: "Пациент",
    invoicesDue: "По счетам",
    externalReceivable: "Расходы GMED",
    adjustments: "Корректировки",
    advances: "Авансы",
    balance: "Сальдо",
    status: "Статус",
    document: "Документ",
    openOriginal: "Открыть оригинал документа",
    previewOriginal: "Просмотр документа",
    documentOpenError: "Не удалось открыть оригинал документа. Повторите попытку.",
    documentPopupBlocked: "Разрешите открытие новой вкладки, чтобы посмотреть документ.",
    provider: "Поставщик",
    order: "Заказ",
    dueDate: "Срок оплаты",
    amount: "Сумма",
    payable: "К оплате",
    expected: "Ожидается",
    partiallyPaid: "Частично оплачено",
    settledProvider: "Оплачено",
    openProviderPayments: "Открытые",
    providerSettlements: "Расчеты",
    byProviders: "По поставщикам",
    providerDocuments: "Документы",
    allProviders: "Все поставщики",
    providerNotAssigned: "Поставщик не указан",
    invoiceCount: "Счетов",
    openDocuments: "Открытых счетов",
    partialDocuments: "Частично оплаченных",
    settledDocuments: "Оплаченных счетов",
    latestPayment: "Последняя выплата",
    providerStatement: "Взаиморасчеты",
    originalAmount: "Сумма счета",
    companyPaid: "Выплачено компанией",
    remainingAmount: "Осталось выплатить",
    date: "Дата",
    operation: "Операция",
    net: "Нетто",
    vat: "НДС",
    gross: "Брутто",
    noRows: "Нет данных для выбранных фильтров",
    loading: "Загрузка финансовой позиции…",
    inactive: "Неактивен",
    calculated: "Расчетное",
    confirmed: "Подтверждено",
    shown: (shown: number, total: number) => `Показано ${shown} из ${total}`,
  },
  de: {
    title: "Unternehmenssaldo",
    subtitle: "Finanzposition, Verbindlichkeiten und Geldbewegungen des Unternehmens",
    searchLabel: "Suche",
    from: "Geldbewegungen von",
    to: "bis",
    currency: "Währung",
    movement: "Bewegung",
    allMovements: "Alle Bewegungen",
    inflow: "Einzahlungen",
    outflow: "Auszahlungen",
    search: "Dokument, Patient oder Beschreibung suchen",
    patientReceivables: "Patientenforderungen",
    patientCredits: "Patientenguthaben",
    providerPayables: "Verbindlichkeiten",
    expectedCosts: "Erwartete Kosten",
    calculatedPosition: "Berechnete Position",
    confirmedPosition: "Bestätigte Position",
    cashInflow: "Einzahlungen im Zeitraum",
    cashOutflow: "Auszahlungen im Zeitraum",
    netCashFlow: "Cashflow",
    actualCashBalance: "Tatsächlicher Kontostand",
    reconciliationRequired: "Abstimmung erforderlich",
    reconciliationMessage: (count: number, amount: string) =>
      `${count} Patientensalden müssen abgestimmt werden. Nicht zugeordnete Kosten: ${amount}.`,
    patients: "Patienten",
    providers: "Leistungserbringer",
    cash: "Geldbewegungen",
    financialAccounts: "GMED-Konten",
    conciergeExpenses: "Concierge-Auslagen",
    financialAccount: "GMED-Konto",
    unassignedAccount: "Nicht zugeordnet",
    assignmentFailed: "Das Konto der Geldbewegung konnte nicht geändert werden.",
    all: "Alle",
    debit: "Forderung",
    credit: "Guthaben",
    reconciliation: "Abstimmung",
    patient: "Patient",
    invoicesDue: "Rechnungen offen",
    externalReceivable: "GMED-Auslagen",
    adjustments: "Korrekturen",
    advances: "Vorauszahlungen",
    balance: "Saldo",
    status: "Status",
    document: "Beleg",
    openOriginal: "Originaldokument öffnen",
    previewOriginal: "Dokument ansehen",
    documentOpenError: "Das Originaldokument konnte nicht geöffnet werden. Bitte erneut versuchen.",
    documentPopupBlocked: "Bitte das Öffnen eines neuen Tabs erlauben, um das Dokument anzusehen.",
    provider: "Leistungserbringer",
    order: "Auftrag",
    dueDate: "Fällig am",
    amount: "Betrag",
    payable: "Zu zahlen",
    expected: "Erwartet",
    partiallyPaid: "Teilweise bezahlt",
    settledProvider: "Bezahlt",
    openProviderPayments: "Offen",
    providerSettlements: "Abrechnung",
    byProviders: "Nach Leistungserbringer",
    providerDocuments: "Belege",
    allProviders: "Alle Leistungserbringer",
    providerNotAssigned: "Leistungserbringer nicht angegeben",
    invoiceCount: "Rechnungen",
    openDocuments: "Offene Rechnungen",
    partialDocuments: "Teilweise bezahlte Rechnungen",
    settledDocuments: "Bezahlte Rechnungen",
    latestPayment: "Letzte Auszahlung",
    providerStatement: "Kontenabstimmung",
    originalAmount: "Rechnungsbetrag",
    companyPaid: "Vom Unternehmen bezahlt",
    remainingAmount: "Noch zu zahlen",
    date: "Datum",
    operation: "Vorgang",
    net: "Netto",
    vat: "MwSt.",
    gross: "Brutto",
    noRows: "Keine Daten für die gewählten Filter",
    loading: "Finanzposition wird geladen…",
    inactive: "Inaktiv",
    calculated: "Berechnet",
    confirmed: "Bestätigt",
    shown: (shown: number, total: number) => `${shown} von ${total} angezeigt`,
  },
} as const;

function parseAmount(value: string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: string | null | undefined, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(parseAmount(value));
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale);
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative" | "warning";
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border border-border/70 border-l-[3px] bg-card px-2.5 py-2 shadow-xs sm:px-3 sm:py-2.5",
        tone === "default" && "border-l-slate-300",
        tone === "positive" && "border-l-emerald-400",
        tone === "negative" && "border-l-rose-400",
        tone === "warning" && "border-l-amber-400",
      )}
    >
      <p className="line-clamp-2 min-h-7 text-[10px] font-medium leading-3.5 text-muted-foreground sm:min-h-0 sm:truncate sm:text-[11px]" title={label}>{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate text-sm font-semibold tracking-tight tabular-nums sm:mt-1 sm:text-base",
          tone === "positive" && "text-emerald-700 dark:text-emerald-400",
          tone === "negative" && "text-rose-700 dark:text-rose-400",
          tone === "warning" && "text-amber-700 dark:text-amber-400",
        )}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

export function CompanyFinancePage() {
  const { lang } = useLang();
  const text = textByLanguage[lang];
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const [filters, setFilters] = useState<CompanyFinancialFilters>(initialFilters);
  const [activeTab, setActiveTab] = useState(
    () => {
      const params = new URL(window.location.href).searchParams;
      if (params.has("provider_invoice") || params.has("provider")) return "providers";
      const requestedTab = params.get("tab");
      return ["patients", "providers", "concierge-expenses", "accounts", "cash"].includes(
        requestedTab ?? "",
      )
        ? requestedTab!
        : "patients";
    },
  );
  const [requestedExpenseId] = useState(
    () => new URL(window.location.href).searchParams.get("expense"),
  );
  const [patientSide, setPatientSide] = useState<PatientSideFilter>("all");
  const [providerFilter, setProviderFilter] = useState<ProviderSettlementFilter>("open");
  const [providerView, setProviderView] = useState<ProviderView>("providers");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedProviderLiability, setSelectedProviderLiability] =
    useState<CompanyProviderLiability | null>(null);
  const [statementProvider, setStatementProvider] =
    useState<CompanyProviderPosition | null>(null);
  const [position, setPosition] = useState<CompanyFinancialPosition | null>(null);
  const [accounts, setAccounts] = useState<CompanyFinancialAccountsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const documentPreviewBusy = useRef(false);
  const [assignmentBusyId, setAssignmentBusyId] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [conciergeExpensePendingCount, setConciergeExpensePendingCount] = useState(0);

  useFinanceAutoRefresh(() => {
    setReloadToken((current) => current + 1);
  }, loading);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void Promise.all([
        fetchCompanyFinancialPosition(filters, true),
        fetchCompanyFinancialAccounts(filters.currency, true),
      ])
        .then(([result, accountResult]) => {
          if (!active) return;
          setError(null);
          setPosition(result);
          setAccounts(accountResult);
          if (!filters.currency && result.currency) {
            setFilters((current) => ({ ...current, currency: result.currency }));
          }
        })
        .catch((requestError: unknown) => {
          if (!active) return;
          setError(requestError instanceof Error ? requestError.message : "Failed to load");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, filters.search ? 250 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filters, reloadToken]);

  useEffect(() => {
    if (!position || selectedProviderLiability) return;
    const url = new URL(window.location.href);
    const requestedId = url.searchParams.get("provider_invoice");
    if (!requestedId) return;
    const requested = position.provider_liabilities.find((item) => item.id === requestedId);
    url.searchParams.delete("provider_invoice");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    if (requested) {
      setActiveTab("providers");
      setProviderView("documents");
      setSelectedProviderId(providerGroupKey(requested));
      setProviderFilter("all");
      setSelectedProviderLiability(requested);
    }
  }, [position, selectedProviderLiability]);

  useEffect(() => {
    if (!position) return;
    const url = new URL(window.location.href);
    const requestedProviderId = url.searchParams.get("provider");
    if (!requestedProviderId) return;
    const shouldOpenStatement = url.searchParams.get("statement") === "1";
    const requestedProvider = position.provider_positions.find(
      (item) => item.provider_id === requestedProviderId,
    );
    url.searchParams.delete("provider");
    url.searchParams.delete("statement");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setActiveTab("providers");
    setProviderView("providers");
    setSelectedProviderId(requestedProviderId);
    if (shouldOpenStatement && requestedProvider) {
      setStatementProvider(requestedProvider);
    }
  }, [position]);

  const currency = position?.currency || filters.currency || "EUR";

  function handleActiveTabChange(value: string) {
    setActiveTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    if (value !== "concierge-expenses") url.searchParams.delete("expense");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  const money = (value: string | null | undefined) => formatMoney(value, currency, locale);
  const patientRows = useMemo(() => filterPatientPositions(position?.patient_positions ?? [], patientSide, filters.search), [patientSide, position?.patient_positions, filters.search]);
  const providerRows = useMemo(() => filterProviderDocuments(position?.provider_liabilities ?? [], providerFilter, selectedProviderId, filters.search), [position?.provider_liabilities, providerFilter, selectedProviderId, filters.search]);
  const providerPositionRows = useMemo(() => filterProviderPositions(position?.provider_positions ?? [], position?.provider_liabilities ?? [], providerFilter, selectedProviderId, filters.search), [position?.provider_positions, position?.provider_liabilities, providerFilter, selectedProviderId, filters.search]);
  const selectedProviderName = selectedProviderId === null
    ? null
    : position?.provider_positions.find((row) => providerGroupKey(row) === selectedProviderId)?.provider_name?.trim()
        || position?.provider_liabilities.find((row) => providerGroupKey(row) === selectedProviderId)?.provider_name?.trim()
        || text.providerNotAssigned;
  const selectedProviderDocumentCount = selectedProviderId === null
    ? position?.provider_liabilities.length ?? 0
    : (position?.provider_liabilities ?? []).filter((row) => (
      providerGroupKey(row) === selectedProviderId
    )).length;

  const summary = position?.summary;
  const netCashFlow = parseAmount(summary?.net_cash_flow);
  const calculatedNet = parseAmount(summary?.calculated_net_position);
  const actualCashBalance = (accounts?.items ?? [])
    .reduce((sum, account) => sum + parseAmount(account.current_balance), 0);

  const patientColumns = useMemo<ColumnDef<CompanyPatientPosition>[]>(() => [
    {
      id: "patient",
      label: text.patient,
      accessor: (row) => `${row.patient_name} ${row.patient_pid}`,
      filterType: "text",
      searchable: true,
      sortable: true,
      required: true,
      pinned: "left",
      width: 260,
      render: (row) => (
        <div className="min-w-0">
          <StaffLink className="truncate font-medium text-foreground hover:text-primary hover:underline" to={`/patients/${row.patient_id}?tab=invoices`}>
            {row.patient_name || row.patient_pid}
          </StaffLink>
          {!row.is_active || row.reconciliation_required ? (
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {!row.is_active ? <Badge variant="outline" className="rounded-full text-[10px]">{text.inactive}</Badge> : null}
            {row.reconciliation_required ? <Badge className="rounded-full border-amber-200 bg-amber-50 text-[10px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" variant="outline">{text.reconciliation}</Badge> : null}
          </div>
          ) : null}
        </div>
      ),
    },
    { id: "invoice_due", label: text.invoicesDue, accessor: (row) => parseAmount(row.invoice_due), filterType: "number", sortable: true, width: 145, render: (row) => money(row.invoice_due) },
    { id: "external_receivable", label: text.externalReceivable, accessor: (row) => parseAmount(row.external_receivable), filterType: "number", sortable: true, width: 150, render: (row) => money(row.external_receivable) },
    { id: "manual_balance", label: text.adjustments, accessor: (row) => parseAmount(row.manual_balance), filterType: "number", sortable: true, width: 140, render: (row) => money(row.manual_balance) },
    { id: "prepayment", label: text.advances, accessor: (row) => parseAmount(row.available_prepayment), filterType: "number", sortable: true, width: 140, render: (row) => parseAmount(row.available_prepayment) > 0 ? <span className="text-rose-700 dark:text-rose-400">− {money(row.available_prepayment)}</span> : money("0") },
    {
      id: "balance",
      label: text.balance,
      accessor: (row) => parseAmount(row.calculated_balance),
      filterType: "number",
      sortable: true,
      width: 150,
      render: (row) => (
        <div className={cn("font-semibold", row.balance_side === "debit" && "text-emerald-700 dark:text-emerald-400", row.balance_side === "credit" && "text-rose-700 dark:text-rose-400")}>
          {money(row.calculated_balance)}
          <div className="text-[10px] font-normal text-muted-foreground">{row.balance_side === "debit" ? text.debit : row.balance_side === "credit" ? text.credit : "—"}</div>
        </div>
      ),
    },
  ], [money, text]);

  const providerPositionColumns = useMemo<ColumnDef<CompanyProviderPosition>[]>(() => [
    {
      id: "provider",
      label: text.provider,
      accessor: (row) => providerDisplayName(row, text.providerNotAssigned),
      filterType: "text",
      searchable: true,
      sortable: true,
      required: true,
      pinned: "left",
      width: 260,
      render: (row) => row.provider_id ? (
        <StaffLink className="font-medium hover:text-primary hover:underline" to={`/providers/${row.provider_id}`} onClick={(event) => event.stopPropagation()}>
          {providerDisplayName(row, text.providerNotAssigned)}
        </StaffLink>
      ) : <span className="font-medium">{providerDisplayName(row, text.providerNotAssigned)}</span>,
    },
    { id: "invoice_count", label: text.invoiceCount, accessor: (row) => row.invoice_count, filterType: "number", sortable: true, width: 110 },
    { id: "invoice_total", label: text.originalAmount, accessor: (row) => parseAmount(row.invoice_total_gross), filterType: "number", sortable: true, width: 160, render: (row) => money(row.invoice_total_gross) },
    { id: "company_paid", label: text.companyPaid, accessor: (row) => parseAmount(row.company_paid_gross), filterType: "number", sortable: true, width: 180, render: (row) => <span className="text-emerald-700 dark:text-emerald-400">{money(row.company_paid_gross)}</span> },
    { id: "remaining", label: text.remainingAmount, accessor: (row) => parseAmount(row.payable_remaining_gross), filterType: "number", sortable: true, width: 170, render: (row) => <span className={cn("font-semibold", parseAmount(row.payable_remaining_gross) > 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400")}>{money(row.payable_remaining_gross)}</span> },
    { id: "expected", label: text.expectedCosts, accessor: (row) => parseAmount(row.expected_remaining_gross), filterType: "number", sortable: true, width: 160, render: (row) => money(row.expected_remaining_gross) },
    { id: "open_count", label: text.openDocuments, accessor: (row) => row.open_invoice_count, filterType: "number", sortable: true, width: 150 },
    { id: "partial_count", label: text.partialDocuments, accessor: (row) => row.partial_invoice_count, filterType: "number", sortable: true, width: 190 },
    { id: "settled_count", label: text.settledDocuments, accessor: (row) => row.settled_invoice_count, filterType: "number", sortable: true, width: 170 },
    { id: "latest_payment", label: text.latestPayment, accessor: (row) => row.latest_payment_on, filterType: "date", sortable: true, width: 160, render: (row) => formatDate(row.latest_payment_on, locale) },
    { id: "statement", label: text.providerStatement, accessor: (row) => row.provider_id ?? "", width: 150, render: (row) => row.provider_id ? <Button type="button" size="xs" variant="outline" onClick={(event) => { event.stopPropagation(); setStatementProvider(row); }}>{text.providerStatement}</Button> : "—" },
  ], [locale, money, text]);

  const openProviderDocument = useCallback(async (documentId: string) => {
    if (documentPreviewBusy.current) return;
    setDocumentError(null);
    // Reserve the tab inside the click event, before the authenticated file request.
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      setDocumentError(text.documentPopupBlocked);
      return;
    }
    previewWindow.opener = null;
    documentPreviewBusy.current = true;
    setOpeningDocumentId(documentId);
    try {
      await openDocumentPreview(documentId, text.documentPopupBlocked, previewWindow);
    } catch {
      previewWindow.close();
      setDocumentError(text.documentOpenError);
    } finally {
      documentPreviewBusy.current = false;
      setOpeningDocumentId(null);
    }
  }, [text.documentOpenError, text.documentPopupBlocked]);

  const providerColumns = useMemo<ColumnDef<CompanyProviderLiability>[]>(() => [
    {
      id: "document",
      label: text.document,
      accessor: (row) => row.external_invoice_number,
      filterType: "text",
      searchable: true,
      sortable: true,
      required: true,
      pinned: "left",
      width: 190,
      render: (row) => row.source_document_id ? (
        <div className="flex min-w-0 max-w-full items-center gap-1">
        <button
          type="button"
          className="min-w-0 truncate rounded text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          title={`${text.openOriginal}: ${row.source_document_name || row.external_invoice_number}`}
          aria-label={`${text.openOriginal}: ${row.external_invoice_number}`}
          aria-busy={openingDocumentId === row.source_document_id}
          disabled={Boolean(openingDocumentId)}
          onKeyDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); void openProviderDocument(row.source_document_id!); }}
        >
          {row.external_invoice_number}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          title={text.previewOriginal}
          aria-label={`${text.previewOriginal}: ${row.external_invoice_number}`}
          data-document-preview-id={row.source_document_id}
          aria-busy={openingDocumentId === row.source_document_id}
          disabled={Boolean(openingDocumentId)}
          onKeyDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); void openProviderDocument(row.source_document_id!); }}
        >
          {openingDocumentId === row.source_document_id ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Eye aria-hidden className="size-4" />}
        </Button>
        </div>
      ) : <div className="truncate font-medium" title={row.external_invoice_number}>{row.external_invoice_number}</div>,
    },
    {
      id: "status",
      label: text.status,
      accessor: (row) => row.liability_kind === "payable" && row.settlement_status === "partial" ? "partial" : row.liability_kind,
      filterType: "enum",
      filterOptions: [
        { value: "payable", label: text.payable },
        { value: "partial", label: text.partiallyPaid },
        { value: "settled", label: text.settledProvider },
        { value: "expected", label: text.expected },
      ],
      sortable: true,
      width: 175,
      render: (row) => (
          <Badge variant="outline" className={cn(
            "rounded-full text-[10px]",
            row.liability_kind === "settled" && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
            row.liability_kind === "expected" && "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400",
            row.liability_kind === "payable" && "border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400",
          )}>
            {row.liability_kind === "settled"
              ? text.settledProvider
              : row.liability_kind === "expected"
                ? text.expected
                : row.settlement_status === "partial"
                  ? text.partiallyPaid
                  : text.payable}
          </Badge>
      ),
    },
    { id: "provider", label: text.provider, accessor: (row) => row.provider_name ?? "", filterType: "text", searchable: true, sortable: true, width: 210, render: (row) => row.provider_id ? <StaffLink className="hover:text-primary hover:underline" to={`/providers/${row.provider_id}`}>{row.provider_name || "—"}</StaffLink> : row.provider_name || "—" },
    { id: "amount", label: text.originalAmount, accessor: (row) => parseAmount(row.amount_gross), filterType: "number", sortable: true, width: 140, render: (row) => money(row.amount_gross) },
    { id: "company_paid", label: text.companyPaid, accessor: (row) => parseAmount(row.company_paid_gross), filterType: "number", sortable: true, width: 180, render: (row) => <span className="text-emerald-700 dark:text-emerald-400">{money(row.company_paid_gross)}</span> },
    { id: "remaining", label: text.remainingAmount, accessor: (row) => parseAmount(row.remaining_gross), filterType: "number", sortable: true, width: 170, render: (row) => <span className={cn("font-semibold", parseAmount(row.remaining_gross) > 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400")}>{money(row.remaining_gross)}</span> },
    { id: "due_date", label: text.dueDate, accessor: (row) => row.due_date, filterType: "date", sortable: true, width: 140, render: (row) => formatDate(row.due_date, locale) },
    { id: "patient", label: text.patient, accessor: (row) => `${row.patient_name} ${row.patient_pid ?? ""}`, filterType: "text", searchable: true, sortable: true, width: 210, render: (row) => row.patient_id ? <StaffLink className="hover:text-primary hover:underline" to={`/patients/${row.patient_id}?tab=invoices`}>{row.patient_name || row.patient_pid || "—"}</StaffLink> : "—" },
    { id: "order", label: text.order, accessor: (row) => row.order_number ?? "", filterType: "text", searchable: true, sortable: true, width: 150, render: (row) => row.order_id ? <StaffLink className="hover:text-primary hover:underline" to={`/orders/${row.order_id}`}>{row.order_number || "—"}</StaffLink> : "—" },
    { id: "settlement", label: text.providerSettlements, accessor: (row) => row.settlement_status, filterType: "enum", width: 130, render: (row) => <Button type="button" size="xs" variant="outline" onClick={(event) => { event.stopPropagation(); setSelectedProviderLiability(row); }}>{text.providerSettlements}</Button> },
  ], [locale, money, openProviderDocument, openingDocumentId, text]);

  const cashColumns = useMemo<ColumnDef<CompanyCashMovement>[]>(() => [
    { id: "date", label: text.date, accessor: (row) => row.entry_date, filterType: "date", sortable: true, pinned: "left", width: 130, render: (row) => formatDate(row.entry_date, locale) },
    { id: "operation", label: text.operation, accessor: (row) => `${row.description} ${row.category}`, filterType: "text", searchable: true, sortable: true, required: true, width: 280, render: (row) => <div className="truncate font-medium" title={row.description}>{row.description}</div> },
    { id: "document", label: text.document, accessor: (row) => `${row.invoice_number ?? ""} ${row.external_invoice_number ?? ""} ${row.order_number ?? ""}`, filterType: "text", searchable: true, sortable: true, width: 180, render: (row) => <div><div>{row.invoice_number || row.external_invoice_number || "—"}</div>{row.order_id ? <StaffLink className="text-[10px] text-muted-foreground hover:text-primary hover:underline" to={`/orders/${row.order_id}`}>{row.order_number}</StaffLink> : null}</div> },
    { id: "patient", label: text.patient, accessor: (row) => `${row.patient_name ?? ""} ${row.patient_pid ?? ""}`, filterType: "text", searchable: true, sortable: true, width: 210, render: (row) => row.patient_id ? <StaffLink className="hover:text-primary hover:underline" to={`/patients/${row.patient_id}?tab=invoices`}>{row.patient_name || row.patient_pid || "—"}</StaffLink> : "—" },
    {
      id: "account",
      label: text.financialAccount,
      accessor: (row) => row.financial_account_name ?? "",
      filterType: "enum",
      filterOptions: (accounts?.items ?? []).map((account) => ({ value: account.name, label: account.name })),
      sortable: true,
      width: 210,
      render: (row) => (
        <select
          className={cn(shellSelectClassName, "h-8 min-w-44 rounded-md bg-field text-xs")}
          value={row.financial_account_id ?? ""}
          disabled={assignmentBusyId === row.id}
          aria-label={text.financialAccount}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => void handleAssignMovement(row.id, event.target.value)}
        >
          <option value="" disabled>{text.unassignedAccount}</option>
          {(accounts?.items ?? []).map((account) => <option key={account.id} value={account.id} disabled={!account.is_active}>{account.name}{account.is_active ? "" : ` · ${text.inactive}`}</option>)}
        </select>
      ),
    },
    { id: "net", label: text.net, accessor: (row) => parseAmount(row.amount_net), filterType: "number", sortable: true, width: 130, render: (row) => money(row.amount_net) },
    { id: "vat", label: text.vat, accessor: (row) => parseAmount(row.amount_vat), filterType: "number", sortable: true, width: 120, render: (row) => money(row.amount_vat) },
    { id: "gross", label: text.gross, accessor: (row) => parseAmount(row.amount_gross), filterType: "number", sortable: true, width: 150, render: (row) => <span className={cn("font-semibold", row.movement === "inflow" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>{row.movement === "inflow" ? "+" : "−"} {money(row.amount_gross)}</span> },
  ], [accounts?.items, assignmentBusyId, locale, money, text]);

  async function handleAssignMovement(entryId: string, financialAccountId: string) {
    setAssignmentBusyId(entryId);
    setAssignmentError(null);
    try {
      await assignAccountingEntryFinancialAccount(entryId, financialAccountId);
      setReloadToken((current) => current + 1);
    } catch (requestError) {
      setAssignmentError(
        requestError instanceof Error ? requestError.message : text.assignmentFailed,
      );
    } finally {
      setAssignmentBusyId("");
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={text.title}
        description={text.subtitle}
      />

      <section className="relative z-30 grid grid-cols-2 items-end gap-2 rounded-lg border border-border/70 bg-card p-2.5 shadow-sm sm:flex sm:flex-nowrap sm:gap-1.5 sm:overflow-x-auto sm:px-3 sm:py-2">
        <ToolbarField label={text.from} className="w-full sm:w-[150px]">
          <Input
            type="date"
            className="h-8 rounded-md bg-field text-xs"
            value={filters.from}
            onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
          />
        </ToolbarField>
        <ToolbarField label={text.to} className="w-full sm:w-[150px]">
          <Input
            type="date"
            className="h-8 rounded-md bg-field text-xs"
            value={filters.to}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
          />
        </ToolbarField>
        <ToolbarField label={text.currency} className="w-full sm:w-[96px]">
          <select
            className={cn(shellSelectClassName, "h-8 rounded-md bg-field text-xs")}
            value={filters.currency || currency}
            onChange={(event) => setFilters((current) => ({ ...current, currency: event.target.value }))}
          >
            {(position?.available_currencies.length ? position.available_currencies : [currency]).map(
              (value) => <option key={value} value={value}>{value}</option>,
            )}
          </select>
        </ToolbarField>
        <ToolbarField label={text.searchLabel} className="col-span-2 w-full sm:col-auto sm:w-[280px]">
          <span className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              className="h-8 rounded-md bg-field pl-8 text-xs"
              placeholder={text.search}
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            />
          </span>
        </ToolbarField>
      </section>

      {error ? <ShellBanner tone="error">{error}</ShellBanner> : null}

      {summary ? (
        <>
          <section className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-5">
            <SummaryCard label={text.patientReceivables} value={money(summary.patient_receivables_calculated)} tone="positive" />
            <SummaryCard label={text.patientCredits} value={money(summary.patient_credits)} tone="negative" />
            <SummaryCard label={text.providerPayables} value={money(summary.provider_payables)} tone="negative" />
            <SummaryCard label={text.expectedCosts} value={money(summary.expected_provider_costs)} tone="warning" />
            <SummaryCard
              label={text.calculatedPosition}
              value={money(summary.calculated_net_position)}
              tone={calculatedNet >= 0 ? "positive" : "negative"}
            />
            <SummaryCard
              label={text.confirmedPosition}
              value={summary.confirmed_net_position === null ? text.reconciliationRequired : money(summary.confirmed_net_position)}
              tone={summary.confirmed_net_position === null ? "warning" : "default"}
            />
            <SummaryCard label={text.cashInflow} value={money(summary.cash_inflow)} tone="positive" />
            <SummaryCard label={text.cashOutflow} value={money(summary.cash_outflow)} tone="negative" />
            <SummaryCard
              label={text.actualCashBalance}
              value={money(String(actualCashBalance))}
              tone={actualCashBalance >= 0 ? "positive" : "negative"}
            />
            <SummaryCard
              label={text.netCashFlow}
              value={money(summary.net_cash_flow)}
              tone={netCashFlow >= 0 ? "positive" : "negative"}
            />
          </section>

          {summary.reconciliation_required ? (
            <ShellBanner tone="warning" withIcon>
              {text.reconciliationMessage(
                summary.reconciliation_patient_count,
                money(summary.unreconciled_external_receivables),
              )}
            </ShellBanner>
          ) : null}
        </>
      ) : loading ? (
        <div className="rounded-lg border border-border/70 bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          {text.loading}
        </div>
      ) : null}

      {position && accounts ? (
        <Tabs value={activeTab} onValueChange={handleActiveTabChange} className="min-w-0 gap-3">
          <div className="-mx-2.5 overflow-x-auto overflow-y-hidden px-2.5 pb-1 sm:mx-0 sm:px-0">
            <div className="flex w-max min-w-full justify-center">
              <TabsList className="h-auto w-max max-w-none flex-nowrap gap-1 rounded-none bg-transparent p-0">
                {([
                  ["patients", UsersRound, text.patients, position.patient_positions.length],
                  ["providers", Building2, text.providers, position.provider_positions.length],
                  ["concierge-expenses", ReceiptText, text.conciergeExpenses, conciergeExpensePendingCount],
                  ["accounts", Landmark, text.financialAccounts, accounts.items.length],
                  ["cash", ArrowLeftRight, text.cash, position.cash_movement_count],
                ] as const).map(([value, Icon, label, count]) => (
                  <TabsTrigger
                    key={value}
                    className={cn(
                      buttonVariants({ variant: activeTab === value ? "default" : "ghost", size: "sm" }),
                      "h-9 min-w-0 rounded-md px-3 text-xs text-foreground data-active:!bg-primary data-active:!text-primary-foreground data-active:shadow-none data-active:[&_[data-count]]:bg-white/20 data-active:[&_[data-count]]:text-primary-foreground sm:h-8",
                    )}
                    value={value}
                  >
                    <Icon />
                    <span>{label}</span>
                    <span data-count className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
                      {count}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>

          <TabsContent value="patients">
            <DataTableSurface
              rows={patientRows}
              columns={patientColumns}
              rowId={(row) => row.patient_id}
              storageKey="company-finance-patients"
              defaultDensity="compact"
              rowHeightOverrides={{ comfortable: 60, compact: 56, condensed: 52 }}
              toolbarClassName="sm:flex-wrap"
              defaultSort={[{ field: "patient", dir: "asc" }]}
              emptyState={text.noRows}
              pagination={{ pageSize: 50, resetKey: patientSide }}
              toolbarStart={(
                <div className="flex shrink-0 items-end gap-1">
                  {([ ["all", text.all], ["debit", text.debit], ["credit", text.credit], ["reconciliation", text.reconciliation] ] as const).map(([value, label]) => (
                    <Button key={value} type="button" size="sm" className="h-8 rounded-md px-2.5 text-xs" variant={patientSide === value ? "default" : "ghost"} onClick={() => setPatientSide(value)}>{label}</Button>
                  ))}
                  <span className="self-center px-1 text-[10px] tabular-nums text-muted-foreground">{text.shown(patientRows.length, position.patient_positions.length)}</span>
                </div>
              )}
            />
          </TabsContent>

          <TabsContent value="providers" className="space-y-2">
            {documentError ? <ShellBanner tone="error">{documentError}</ShellBanner> : null}
            <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border/70 bg-card p-1.5">
              <Button type="button" size="sm" className="h-8 rounded-md px-3 text-xs" variant={providerView === "providers" ? "default" : "ghost"} onClick={() => { setProviderView("providers"); setSelectedProviderId(null); }}>{text.byProviders}</Button>
              <Button type="button" size="sm" className="h-8 rounded-md px-3 text-xs" variant={providerView === "documents" ? "default" : "ghost"} onClick={() => setProviderView("documents")}>{text.providerDocuments}</Button>
              {selectedProviderName ? <Badge variant="outline" className="ml-1 rounded-full">{selectedProviderName}</Badge> : null}
              {selectedProviderId !== null ? (
                <Button type="button" size="sm" className="ml-auto h-8 rounded-md px-3 text-xs" variant="outline" onClick={() => setSelectedProviderId(null)}>{text.allProviders}</Button>
              ) : null}
            </div>

            {providerView === "providers" ? (
              <DataTableSurface
                key="provider-positions"
                rows={providerPositionRows}
                columns={providerPositionColumns}
                rowId={providerGroupKey}
                storageKey="company-finance-provider-positions"
                toolbarClassName="sm:flex-wrap"
                defaultDensity="compact"
                defaultSort={[{ field: "remaining", dir: "desc" }]}
                emptyState={text.noRows}
                pagination={{ pageSize: 50, resetKey: providerFilter }}
                onRowClick={(row) => {
                  setSelectedProviderId(providerGroupKey(row));
                  setProviderView("documents");
                }}
                toolbarStart={(
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {([
                      ["open", text.openProviderPayments],
                      ["partial", text.partiallyPaid],
                      ["settled", text.settledProvider],
                      ["expected", text.expected],
                      ["all", text.all],
                    ] as const).map(([value, label]) => (
                      <Button key={value} type="button" size="sm" className="h-8 rounded-md px-2.5 text-xs" variant={providerFilter === value ? "default" : "ghost"} onClick={() => setProviderFilter(value)}>{label}</Button>
                    ))}
                    <span className="self-center px-1 text-[10px] tabular-nums text-muted-foreground">{text.shown(providerPositionRows.length, position.provider_positions.length)}</span>
                  </div>
                )}
              />
            ) : (
              <DataTableSurface
                key="provider-documents"
                rows={providerRows}
                columns={providerColumns}
                rowId={(row) => row.id}
                storageKey="company-finance-provider-documents"
                toolbarClassName="sm:flex-wrap"
                defaultDensity="compact"
                mobilePrimaryColumnId="document"
                mobileDetailColumnIds={["status", "provider", "amount", "company_paid", "remaining"]}
                defaultSort={[{ field: "due_date", dir: "asc" }]}
                emptyState={text.noRows}
                pagination={{ pageSize: 50, resetKey: `${providerFilter}:${selectedProviderId ?? "all"}` }}
                onRowClick={setSelectedProviderLiability}
                toolbarStart={(
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {([
                      ["open", text.openProviderPayments],
                      ["partial", text.partiallyPaid],
                      ["settled", text.settledProvider],
                      ["expected", text.expected],
                      ["all", text.all],
                    ] as const).map(([value, label]) => (
                      <Button key={value} type="button" size="sm" className="h-8 rounded-md px-2.5 text-xs" variant={providerFilter === value ? "default" : "ghost"} onClick={() => setProviderFilter(value)}>{label}</Button>
                    ))}
                    <span className="self-center px-1 text-[10px] tabular-nums text-muted-foreground">{text.shown(providerRows.length, selectedProviderDocumentCount)}</span>
                  </div>
                )}
              />
            )}
          </TabsContent>

          <TabsContent value="accounts">
            <CompanyAccountsWorkspace
              payload={accounts}
              currency={currency}
              locale={locale}
              money={money}
              onChanged={() => setReloadToken((current) => current + 1)}
            />
          </TabsContent>

          <TabsContent value="concierge-expenses">
            <ConciergeExpenseReviewPanel
              accounts={accounts.items}
              locale={locale}
              onChanged={() => setReloadToken((current) => current + 1)}
              onPendingCountChange={setConciergeExpensePendingCount}
              requestedExpenseId={requestedExpenseId}
            />
          </TabsContent>

          <TabsContent value="cash" className="space-y-2">
            {assignmentError ? <ShellBanner tone="error">{assignmentError}</ShellBanner> : null}
            <DataTableSurface
              rows={position.cash_movements}
              columns={cashColumns}
              rowId={(row) => row.id}
              storageKey="company-finance-cash"
              defaultDensity="compact"
              defaultSort={[{ field: "date", dir: "desc" }]}
              defaultFrozenColumns={["date"]}
              emptyState={text.noRows}
              pagination={{ pageSize: 50, resetKey: filters.movement }}
              toolbarStart={(
                <ToolbarField label={text.movement} className="w-full shrink-0 sm:w-[180px]">
                  <select
                    className={cn(shellSelectClassName, "h-8 rounded-md bg-field text-xs")}
                    value={filters.movement}
                    onChange={(event) => setFilters((current) => ({
                      ...current,
                      movement: event.target.value as CompanyFinancialFilters["movement"],
                    }))}
                  >
                    <option value="all">{text.allMovements}</option>
                    <option value="inflow">{text.inflow}</option>
                    <option value="outflow">{text.outflow}</option>
                  </select>
                </ToolbarField>
              )}
            />
            {position.cash_movements_truncated ? (
              <p className="text-xs text-muted-foreground">{text.shown(position.cash_movements.length, position.cash_movement_count)}</p>
            ) : null}
          </TabsContent>
        </Tabs>
      ) : null}

      <ProviderSettlementDialog
        liability={selectedProviderLiability}
        accounts={accounts?.items ?? []}
        locale={locale}
        onClose={() => setSelectedProviderLiability(null)}
        onChanged={() => setReloadToken((current) => current + 1)}
      />
      <ProviderStatementDialog
        provider={statementProvider}
        filters={filters}
        locale={locale}
        onClose={() => setStatementProvider(null)}
        onOpenInvoice={(externalInvoiceId) => {
          const liability = position?.provider_liabilities.find((item) => item.id === externalInvoiceId);
          if (!liability) return;
          setStatementProvider(null);
          setSelectedProviderLiability(liability);
        }}
      />
    </div>
  );
}
