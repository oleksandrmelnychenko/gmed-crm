import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  RefreshCw,
  Scale,
  Search,
  UsersRound,
  WalletCards,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
} from "./types";

type PatientSideFilter = "all" | CompanyBalanceSide | "reconciliation";

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
    refresh: "Обновить",
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
    debit: "Дт",
    credit: "Кт",
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
    refresh: "Aktualisieren",
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
    debit: "Soll",
    credit: "Haben",
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
  icon: Icon,
  tone = "default",
  meta,
}: {
  label: string;
  value: string;
  icon: typeof Scale;
  tone?: "default" | "positive" | "negative" | "warning";
  meta?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p
            className={cn(
              "mt-2 truncate text-xl font-semibold tracking-tight tabular-nums",
              tone === "positive" && "text-emerald-700 dark:text-emerald-400",
              tone === "negative" && "text-rose-700 dark:text-rose-400",
              tone === "warning" && "text-amber-700 dark:text-amber-400",
            )}
          >
            {value}
          </p>
          {meta ? <p className="mt-1 text-[11px] text-muted-foreground">{meta}</p> : null}
        </div>
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
            tone === "positive" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
            tone === "negative" && "bg-rose-500/10 text-rose-700 dark:text-rose-400",
            tone === "warning" && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
    </div>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
        {label}
      </td>
    </tr>
  );
}

export function CompanyFinancePage() {
  const { lang } = useLang();
  const text = textByLanguage[lang];
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const [filters, setFilters] = useState<CompanyFinancialFilters>(initialFilters);
  const [patientSide, setPatientSide] = useState<PatientSideFilter>("all");
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

  const summary = position?.summary;
  const netCashFlow = parseAmount(summary?.net_cash_flow);
  const calculatedNet = parseAmount(summary?.calculated_net_position);
  const actualCashBalance = (accounts?.items ?? [])
    .reduce((sum, account) => sum + parseAmount(account.current_balance), 0);

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
    <div className="space-y-5">
      <PageHeader
        title={text.title}
        actions={(
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => setReloadToken((current) => current + 1)}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            {text.refresh}
          </Button>
        )}
      />

      <section className="grid gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-[1fr_1fr_0.7fr_0.9fr_1.5fr]">
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
          <span>{text.from}</span>
          <Input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
          />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
          <span>{text.to}</span>
          <Input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
          />
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
          <span>{text.currency}</span>
          <select
            className={shellSelectClassName}
            value={filters.currency || currency}
            onChange={(event) => setFilters((current) => ({ ...current, currency: event.target.value }))}
          >
            {(position?.available_currencies.length ? position.available_currencies : [currency]).map(
              (value) => <option key={value} value={value}>{value}</option>,
            )}
          </select>
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
          <span>{text.movement}</span>
          <select
            className={shellSelectClassName}
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
        </label>
        <label className="space-y-1.5 text-xs font-medium text-muted-foreground sm:col-span-2 lg:col-span-1">
          <span>{text.search}</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              className="pl-8"
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            />
          </span>
        </label>
      </section>

      {error ? <ShellBanner tone="error">{error}</ShellBanner> : null}

      {summary ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label={text.patientReceivables} value={money(summary.patient_receivables_calculated)} icon={UsersRound} tone="positive" />
            <SummaryCard label={text.patientCredits} value={money(summary.patient_credits)} icon={ArrowDownLeft} tone="negative" />
            <SummaryCard label={text.providerPayables} value={money(summary.provider_payables)} icon={Building2} tone="negative" />
            <SummaryCard label={text.expectedCosts} value={money(summary.expected_provider_costs)} icon={Building2} tone="warning" />
            <SummaryCard
              label={text.calculatedPosition}
              value={money(summary.calculated_net_position)}
              icon={Scale}
              tone={calculatedNet >= 0 ? "positive" : "negative"}
              meta={text.calculated}
            />
            <SummaryCard
              label={text.confirmedPosition}
              value={summary.confirmed_net_position === null ? text.reconciliationRequired : money(summary.confirmed_net_position)}
              icon={summary.confirmed_net_position === null ? AlertTriangle : Scale}
              tone={summary.confirmed_net_position === null ? "warning" : "default"}
              meta={summary.confirmed_net_position === null ? undefined : text.confirmed}
            />
            <SummaryCard label={text.cashInflow} value={money(summary.cash_inflow)} icon={ArrowDownLeft} tone="positive" />
            <SummaryCard label={text.cashOutflow} value={money(summary.cash_outflow)} icon={ArrowUpRight} tone="negative" />
            <SummaryCard
              label={text.actualCashBalance}
              value={money(String(actualCashBalance))}
              icon={WalletCards}
              tone={actualCashBalance >= 0 ? "positive" : "negative"}
            />
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryCard
              label={text.netCashFlow}
              value={money(summary.net_cash_flow)}
              icon={netCashFlow >= 0 ? ArrowDownLeft : ArrowUpRight}
              tone={netCashFlow >= 0 ? "positive" : "negative"}
              meta={`${formatDate(position?.period.from ?? null, locale)} — ${formatDate(position?.period.to ?? null, locale)}`}
            />
            {summary.reconciliation_required ? (
              <ShellBanner tone="warning" withIcon>
                {text.reconciliationMessage(
                  summary.reconciliation_patient_count,
                  money(summary.unreconciled_external_receivables),
                )}
              </ShellBanner>
            ) : (
              <div className="rounded-xl border border-border/70 bg-card p-4 text-sm text-muted-foreground shadow-sm">
                {text.confirmed}: {money(summary.confirmed_net_position)}
              </div>
            )}
          </div>
        </>
      ) : loading ? (
        <div className="rounded-xl border border-border/70 bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          {text.loading}
        </div>
      ) : null}

      {position && accounts ? (
        <Tabs defaultValue="patients">
          <TabsList className="max-w-full overflow-x-auto">
            <TabsTrigger value="patients">{text.patients} · {position.patient_positions.length}</TabsTrigger>
            <TabsTrigger value="providers">{text.providers} · {position.provider_liabilities.length}</TabsTrigger>
            <TabsTrigger value="accounts">{text.financialAccounts} · {accounts.items.length}</TabsTrigger>
            <TabsTrigger value="cash">{text.cash} · {position.cash_movement_count}</TabsTrigger>
          </TabsList>

          <TabsContent value="patients" className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border/70 bg-card p-2 shadow-sm">
              {([
                ["all", text.all],
                ["debit", text.debit],
                ["credit", text.credit],
                ["reconciliation", text.reconciliation],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={patientSide === value ? "secondary" : "ghost"}
                  onClick={() => setPatientSide(value)}
                >
                  {label}
                </Button>
              ))}
              <span className="ml-auto px-2 text-xs text-muted-foreground">
                {text.shown(patientRows.length, position.patient_positions.length)}
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">{text.patient}</th>
                      <th className="px-3 py-3 text-right font-medium">{text.invoicesDue}</th>
                      <th className="px-3 py-3 text-right font-medium">{text.externalReceivable}</th>
                      <th className="px-3 py-3 text-right font-medium">{text.adjustments}</th>
                      <th className="px-3 py-3 text-right font-medium">{text.advances}</th>
                      <th className="px-4 py-3 text-right font-medium">{text.balance}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {patientRows.length ? patientRows.map((row) => (
                      <tr key={row.patient_id} className="hover:bg-muted/25">
                        <td className="px-4 py-3">
                          <StaffLink className="font-medium text-foreground hover:text-primary hover:underline" to={`/patients/${row.patient_id}?tab=invoices`}>
                            {row.patient_name || row.patient_pid}
                          </StaffLink>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{row.patient_pid}</span>
                            {!row.is_active ? <Badge variant="outline">{text.inactive}</Badge> : null}
                            {row.reconciliation_required ? <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400" variant="outline">{text.reconciliation}</Badge> : null}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(row.invoice_due)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(row.external_receivable)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(row.manual_balance)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-rose-700 dark:text-rose-400">− {money(row.available_prepayment)}</td>
                        <td className={cn(
                          "px-4 py-3 text-right font-semibold tabular-nums",
                          row.balance_side === "debit" && "text-emerald-700 dark:text-emerald-400",
                          row.balance_side === "credit" && "text-rose-700 dark:text-rose-400",
                        )}>
                          {money(row.calculated_balance)}
                          <div className="text-[11px] font-normal text-muted-foreground">
                            {row.balance_side === "debit" ? text.debit : row.balance_side === "credit" ? text.credit : "—"}
                          </div>
                        </td>
                      </tr>
                    )) : <EmptyRow colSpan={6} label={text.noRows} />}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="providers">
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[940px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">{text.document}</th>
                      <th className="px-3 py-3 font-medium">{text.provider}</th>
                      <th className="px-3 py-3 font-medium">{text.patient}</th>
                      <th className="px-3 py-3 font-medium">{text.order}</th>
                      <th className="px-3 py-3 font-medium">{text.dueDate}</th>
                      <th className="px-4 py-3 text-right font-medium">{text.amount}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {position.provider_liabilities.length ? position.provider_liabilities.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/25">
                        <td className="px-4 py-3">
                          <div className="font-medium">{row.external_invoice_number}</div>
                          <Badge
                            variant="outline"
                            className={row.liability_kind === "expected" ? "mt-1 bg-amber-500/10 text-amber-700 dark:text-amber-400" : "mt-1 bg-rose-500/10 text-rose-700 dark:text-rose-400"}
                          >
                            {row.liability_kind === "expected" ? text.expected : text.payable}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          {row.provider_id ? (
                            <StaffLink className="hover:text-primary hover:underline" to={`/providers/${row.provider_id}`}>{row.provider_name || "—"}</StaffLink>
                          ) : row.provider_name || "—"}
                        </td>
                        <td className="px-3 py-3">
                          <StaffLink className="hover:text-primary hover:underline" to={`/patients/${row.patient_id}?tab=invoices`}>{row.patient_name || row.patient_pid}</StaffLink>
                        </td>
                        <td className="px-3 py-3">
                          <StaffLink className="hover:text-primary hover:underline" to={`/orders/${row.order_id}`}>{row.order_number}</StaffLink>
                        </td>
                        <td className="px-3 py-3 tabular-nums">{formatDate(row.due_date, locale)}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(row.amount_gross)}</td>
                      </tr>
                    )) : <EmptyRow colSpan={6} label={text.noRows} />}
                  </tbody>
                </table>
              </div>
            </div>
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
            <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1220px] text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">{text.date}</th>
                      <th className="px-3 py-3 font-medium">{text.operation}</th>
                      <th className="px-3 py-3 font-medium">{text.document}</th>
                      <th className="px-3 py-3 font-medium">{text.patient}</th>
                      <th className="px-3 py-3 font-medium">{text.financialAccount}</th>
                      <th className="px-3 py-3 text-right font-medium">{text.net}</th>
                      <th className="px-3 py-3 text-right font-medium">{text.vat}</th>
                      <th className="px-4 py-3 text-right font-medium">{text.gross}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {position.cash_movements.length ? position.cash_movements.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/25">
                        <td className="px-4 py-3 tabular-nums">{formatDate(row.entry_date, locale)}</td>
                        <td className="max-w-[320px] px-3 py-3">
                          <div className="truncate font-medium" title={row.description}>{row.description}</div>
                          <div className="text-xs text-muted-foreground">{row.category}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div>{row.invoice_number || row.external_invoice_number || "—"}</div>
                          {row.order_id ? <StaffLink className="text-xs text-muted-foreground hover:text-primary hover:underline" to={`/orders/${row.order_id}`}>{row.order_number}</StaffLink> : null}
                        </td>
                        <td className="px-3 py-3">
                          {row.patient_id ? <StaffLink className="hover:text-primary hover:underline" to={`/patients/${row.patient_id}?tab=invoices`}>{row.patient_name || row.patient_pid || "—"}</StaffLink> : "—"}
                        </td>
                        <td className="px-3 py-3">
                          <select
                            className={cn(shellSelectClassName, "min-w-44")}
                            value={row.financial_account_id ?? ""}
                            disabled={assignmentBusyId === row.id}
                            aria-label={text.financialAccount}
                            onChange={(event) => void handleAssignMovement(row.id, event.target.value)}
                          >
                            <option value="" disabled>{text.unassignedAccount}</option>
                            {accounts.items.map((account) => (
                              <option key={account.id} value={account.id} disabled={!account.is_active}>
                                {account.name}{account.is_active ? "" : ` · ${text.inactive}`}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(row.amount_net)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{money(row.amount_vat)}</td>
                        <td className={cn(
                          "px-4 py-3 text-right font-semibold tabular-nums",
                          row.movement === "inflow" ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400",
                        )}>
                          {row.movement === "inflow" ? "+" : "−"} {money(row.amount_gross)}
                        </td>
                      </tr>
                    )) : <EmptyRow colSpan={8} label={text.noRows} />}
                  </tbody>
                </table>
              </div>
            </div>
            {position.cash_movements_truncated ? (
              <p className="text-xs text-muted-foreground">{text.shown(position.cash_movements.length, position.cash_movement_count)}</p>
            ) : null}
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
