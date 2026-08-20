import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  Search,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

import { CompanyAccountsWorkspace } from "./accounts-workspace";
import { ProviderSettlementDialog } from "./provider-settlement-dialog";
import { ProviderStatementDialog } from "./provider-statement-dialog";
import {
  assignAccountingEntryFinancialAccount,
  fetchCompanyFinancialAccounts,
  fetchCompanyFinancialPosition,
} from "./data";
import type {
  CompanyBalanceSide,
  CompanyFinancialAccountsPayload,
  CompanyFinancialFilters,
  CompanyFinancialPosition,
  CompanyCashMovement,
  CompanyPatientPosition,
  CompanyProviderLiability,
  CompanyProviderPosition,
} from "./types";

type PatientSideFilter = "all" | CompanyBalanceSide | "reconciliation";
type ProviderSettlementFilter = "open" | "partial" | "settled" | "expected" | "all";
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
    refresh: "Обновить",
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
    refresh: "Aktualisieren",
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
        "min-w-0 rounded-lg border border-border/70 border-l-[3px] bg-card px-3 py-2.5 shadow-xs",
        tone === "default" && "border-l-slate-300",
        tone === "positive" && "border-l-emerald-400",
        tone === "negative" && "border-l-rose-400",
        tone === "warning" && "border-l-amber-400",
      )}
    >
      <p className="truncate text-[11px] font-medium text-muted-foreground" title={label}>{label}</p>
      <p
        className={cn(
          "mt-1 truncate text-base font-semibold tracking-tight tabular-nums",
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
    () => new URL(window.location.href).searchParams.has("provider_invoice") ? "providers" : "patients",
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
  const [assignmentBusyId, setAssignmentBusyId] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void Promise.all([
        fetchCompanyFinancialPosition(filters, reloadToken > 0),
        fetchCompanyFinancialAccounts(filters.currency, reloadToken > 0),
      ])
        .then(([result, accountResult]) => {
          if (!active) return;
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
      setSelectedProviderId(requested.provider_id ?? "__unassigned__");
      setSelectedProviderLiability(requested);
    }
  }, [position, selectedProviderLiability]);

  const currency = position?.currency || filters.currency || "EUR";
  const money = (value: string | null | undefined) => formatMoney(value, currency, locale);
  const patientRows = useMemo(() => {
    const rows = position?.patient_positions ?? [];
    if (patientSide === "all") return rows;
    if (patientSide === "reconciliation") {
      return rows.filter((row) => row.reconciliation_required);
    }
    return rows.filter((row) => row.balance_side === patientSide);
  }, [patientSide, position?.patient_positions]);
  const providerRows = useMemo(() => {
    const rows = (position?.provider_liabilities ?? []).filter((row) => (
      selectedProviderId === null
      || (selectedProviderId === "__unassigned__" ? row.provider_id === null : row.provider_id === selectedProviderId)
    ));
    if (providerFilter === "all") return rows;
    if (providerFilter === "expected") {
      return rows.filter((row) => row.liability_kind === "expected");
    }
    if (providerFilter === "settled") {
      return rows.filter((row) => row.liability_kind === "settled");
    }
    if (providerFilter === "partial") {
      return rows.filter((row) => row.settlement_status === "partial");
    }
    return rows.filter((row) => row.liability_kind === "payable");
  }, [position?.provider_liabilities, providerFilter, selectedProviderId]);
  const providerPositionRows = useMemo(() => {
    const rows = position?.provider_positions ?? [];
    if (providerFilter === "all") return rows;
    if (providerFilter === "expected") {
      return rows.filter((row) => parseAmount(row.expected_remaining_gross) > 0);
    }
    if (providerFilter === "settled") {
      return rows.filter((row) => (
        parseAmount(row.payable_remaining_gross) <= 0
        && parseAmount(row.expected_remaining_gross) <= 0
      ));
    }
    if (providerFilter === "partial") {
      return rows.filter((row) => row.partial_invoice_count > 0);
    }
    return rows.filter((row) => parseAmount(row.payable_remaining_gross) > 0);
  }, [position?.provider_positions, providerFilter]);
  const selectedProviderName = selectedProviderId === null
    ? null
    : selectedProviderId === "__unassigned__"
      ? text.providerNotAssigned
      : position?.provider_positions.find((row) => row.provider_id === selectedProviderId)?.provider_name
        ?? text.providerNotAssigned;
  const selectedProviderDocumentCount = selectedProviderId === null
    ? position?.provider_liabilities.length ?? 0
    : (position?.provider_liabilities ?? []).filter((row) => (
      selectedProviderId === "__unassigned__"
        ? row.provider_id === null
        : row.provider_id === selectedProviderId
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
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span>{row.patient_pid}</span>
            {!row.is_active ? <Badge variant="outline" className="rounded-full text-[10px]">{text.inactive}</Badge> : null}
            {row.reconciliation_required ? <Badge className="rounded-full border-amber-200 bg-amber-50 text-[10px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" variant="outline">{text.reconciliation}</Badge> : null}
          </div>
        </div>
      ),
    },
    { id: "invoice_due", label: text.invoicesDue, accessor: (row) => parseAmount(row.invoice_due), filterType: "number", sortable: true, width: 145, render: (row) => money(row.invoice_due) },
    { id: "external_receivable", label: text.externalReceivable, accessor: (row) => parseAmount(row.external_receivable), filterType: "number", sortable: true, width: 150, render: (row) => money(row.external_receivable) },
    { id: "manual_balance", label: text.adjustments, accessor: (row) => parseAmount(row.manual_balance), filterType: "number", sortable: true, width: 140, render: (row) => money(row.manual_balance) },
    { id: "prepayment", label: text.advances, accessor: (row) => parseAmount(row.available_prepayment), filterType: "number", sortable: true, width: 140, render: (row) => <span className="text-rose-700 dark:text-rose-400">− {money(row.available_prepayment)}</span> },
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
      accessor: (row) => row.provider_name ?? text.providerNotAssigned,
      filterType: "text",
      searchable: true,
      sortable: true,
      required: true,
      pinned: "left",
      width: 260,
      render: (row) => row.provider_id ? (
        <StaffLink className="font-medium hover:text-primary hover:underline" to={`/providers/${row.provider_id}`} onClick={(event) => event.stopPropagation()}>
          {row.provider_name || text.providerNotAssigned}
        </StaffLink>
      ) : <span className="font-medium">{text.providerNotAssigned}</span>,
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
      render: (row) => (
        <div>
          <div className="truncate font-medium">{row.external_invoice_number}</div>
          <Badge variant="outline" className={cn(
            "mt-0.5 rounded-full text-[10px]",
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
        </div>
      ),
    },
    { id: "provider", label: text.provider, accessor: (row) => row.provider_name ?? "", filterType: "text", searchable: true, sortable: true, width: 210, render: (row) => row.provider_id ? <StaffLink className="hover:text-primary hover:underline" to={`/providers/${row.provider_id}`}>{row.provider_name || "—"}</StaffLink> : row.provider_name || "—" },
    { id: "patient", label: text.patient, accessor: (row) => `${row.patient_name} ${row.patient_pid}`, filterType: "text", searchable: true, sortable: true, width: 210, render: (row) => <StaffLink className="hover:text-primary hover:underline" to={`/patients/${row.patient_id}?tab=invoices`}>{row.patient_name || row.patient_pid}</StaffLink> },
    { id: "order", label: text.order, accessor: (row) => row.order_number, filterType: "text", searchable: true, sortable: true, width: 150, render: (row) => <StaffLink className="hover:text-primary hover:underline" to={`/orders/${row.order_id}`}>{row.order_number}</StaffLink> },
    { id: "due_date", label: text.dueDate, accessor: (row) => row.due_date, filterType: "date", sortable: true, width: 140, render: (row) => formatDate(row.due_date, locale) },
    { id: "amount", label: text.originalAmount, accessor: (row) => parseAmount(row.amount_gross), filterType: "number", sortable: true, width: 150, render: (row) => money(row.amount_gross) },
    { id: "company_paid", label: text.companyPaid, accessor: (row) => parseAmount(row.company_paid_gross), filterType: "number", sortable: true, width: 170, render: (row) => <span className="text-emerald-700 dark:text-emerald-400">{money(row.company_paid_gross)}</span> },
    { id: "remaining", label: text.remainingAmount, accessor: (row) => parseAmount(row.remaining_gross), filterType: "number", sortable: true, width: 170, render: (row) => <span className={cn("font-semibold", parseAmount(row.remaining_gross) > 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400")}>{money(row.remaining_gross)}</span> },
    { id: "settlement", label: text.providerSettlements, accessor: (row) => row.settlement_status, filterType: "enum", width: 130, render: (row) => <Button type="button" size="xs" variant="outline" onClick={(event) => { event.stopPropagation(); setSelectedProviderLiability(row); }}>{text.providerSettlements}</Button> },
  ], [locale, money, text]);

  const cashColumns = useMemo<ColumnDef<CompanyCashMovement>[]>(() => [
    { id: "date", label: text.date, accessor: (row) => row.entry_date, filterType: "date", sortable: true, pinned: "left", width: 130, render: (row) => formatDate(row.entry_date, locale) },
    { id: "operation", label: text.operation, accessor: (row) => `${row.description} ${row.category}`, filterType: "text", searchable: true, sortable: true, required: true, width: 280, render: (row) => <div><div className="truncate font-medium" title={row.description}>{row.description}</div><div className="truncate text-[10px] text-muted-foreground">{row.category}</div></div> },
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
        actions={(
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-lg px-3.5"
            disabled={loading}
            onClick={() => setReloadToken((current) => current + 1)}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            {text.refresh}
          </Button>
        )}
      />

      <section className="relative z-30 flex flex-nowrap items-end gap-1.5 overflow-x-auto rounded-lg border border-border/70 bg-card px-3 py-2 shadow-sm">
        <ToolbarField label={text.from} className="w-[150px]">
          <Input
            type="date"
            className="h-8 rounded-md bg-field text-xs"
            value={filters.from}
            onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
          />
        </ToolbarField>
        <ToolbarField label={text.to} className="w-[150px]">
          <Input
            type="date"
            className="h-8 rounded-md bg-field text-xs"
            value={filters.to}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
          />
        </ToolbarField>
        <ToolbarField label={text.currency} className="w-[96px]">
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
        <ToolbarField label={text.movement} className="w-[150px]">
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
        <ToolbarField label={text.searchLabel} className="w-[280px]">
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
          <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-3">
          <TabsList className="mx-auto h-auto max-w-full flex-wrap border border-border bg-card p-1">
            <TabsTrigger className="h-8 rounded-md px-3" value="patients">{text.patients} · {position.patient_positions.length}</TabsTrigger>
            <TabsTrigger className="h-8 rounded-md px-3" value="providers">{text.providers} · {position.provider_positions.length}</TabsTrigger>
            <TabsTrigger className="h-8 rounded-md px-3" value="accounts">{text.financialAccounts} · {accounts.items.length}</TabsTrigger>
            <TabsTrigger className="h-8 rounded-md px-3" value="cash">{text.cash} · {position.cash_movement_count}</TabsTrigger>
          </TabsList>

          <TabsContent value="patients">
            <DataTableSurface
              rows={patientRows}
              columns={patientColumns}
              rowId={(row) => row.patient_id}
              storageKey="company-finance-patients"
              defaultDensity="compact"
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
                rows={providerPositionRows}
                columns={providerPositionColumns}
                rowId={(row) => row.provider_id ?? "__unassigned__"}
                storageKey="company-finance-provider-positions"
                defaultDensity="compact"
                defaultSort={[{ field: "remaining", dir: "desc" }]}
                emptyState={text.noRows}
                pagination={{ pageSize: 50, resetKey: providerFilter }}
                onRowClick={(row) => {
                  setSelectedProviderId(row.provider_id ?? "__unassigned__");
                  setProviderFilter("all");
                  setProviderView("documents");
                }}
                toolbarStart={(
                  <div className="flex shrink-0 items-end gap-1">
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
                rows={providerRows}
                columns={providerColumns}
                rowId={(row) => row.id}
                storageKey="company-finance-provider-documents"
                defaultDensity="compact"
                defaultSort={[{ field: "due_date", dir: "asc" }]}
                emptyState={text.noRows}
                pagination={{ pageSize: 50, resetKey: `${providerFilter}:${selectedProviderId ?? "all"}` }}
                onRowClick={setSelectedProviderLiability}
                toolbarStart={(
                  <div className="flex shrink-0 items-end gap-1">
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

          <TabsContent value="cash" className="space-y-2">
            {assignmentError ? <ShellBanner tone="error">{assignmentError}</ShellBanner> : null}
            <DataTableSurface rows={position.cash_movements} columns={cashColumns} rowId={(row) => row.id} storageKey="company-finance-cash" defaultDensity="compact" defaultSort={[{ field: "date", dir: "desc" }]} defaultFrozenColumns={["date"]} emptyState={text.noRows} pagination={{ pageSize: 50 }} />
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
