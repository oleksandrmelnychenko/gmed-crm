import { lazy, Suspense } from "react";
import {
  ArrowRight,
  CircleDollarSign,
  ClipboardList,
  Landmark,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users as UsersIcon,
  WalletCards,
} from "lucide-react";

import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { numberOrDash } from "../../model/staff-dashboard-formatters";
import type {
  MonthlyEntry,
  ExecutiveFinanceSnapshot,
  OverviewStats,
  Period,
} from "../../model/staff-dashboard-types";
import {
  DashKpi,
  EmptyChart,
  PeriodSwitcher,
  ChartSkeleton,
  type DashboardTranslations,
} from "../shared/staff-dashboard-surface-primitives";
import { OpenTaskQueueLink } from "../open-task-queue-link";

const MonthlyLeadAreaChart = lazy(async () => {
  const {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip: ChartTooltip,
    XAxis,
    YAxis,
  } = await import("recharts");

  return {
    default: function MonthlyLeadAreaChart({ data }: { data: MonthlyEntry[] }) {
      return (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="dashLeadsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity={0.32} />
                <stop offset="100%" stopColor="#f97316" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
            <XAxis
              dataKey="month"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              stroke="#9ca3af"
            />
            <YAxis
              fontSize={11}
              tickLine={false}
              axisLine={false}
              stroke="#9ca3af"
              allowDecimals={false}
            />
            <ChartTooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                fontSize: 12,
              }}
              labelStyle={{ fontSize: 11, color: "#9ca3af" }}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#f97316"
              strokeWidth={2}
              fill="url(#dashLeadsGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      );
    },
  };
});

export function StaffDashboardOverviewSection({
  activePatientCount,
  finance,
  greeting,
  loading,
  monthly,
  newPatientsThisMonth,
  openTasksCount,
  overview,
  onOpenLeads,
  onOpenFinance,
  onOpenOrders,
  onOpenPatients,
  onPeriodChange,
  period,
  tr,
}: {
  activePatientCount: number;
  finance: ExecutiveFinanceSnapshot | null;
  greeting: string;
  loading: boolean;
  monthly: MonthlyEntry[];
  newPatientsThisMonth: number;
  openTasksCount: number;
  overview: OverviewStats | null;
  onOpenLeads: () => void;
  onOpenFinance: () => void;
  onOpenOrders: () => void;
  onOpenPatients: () => void;
  onPeriodChange: (period: Period) => void;
  period: Period;
  tr: DashboardTranslations;
}) {
  const { lang } = useLang();
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const money = (value: string | number | null | undefined) => {
    const numeric = Number(value ?? 0);
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(numeric) ? numeric : 0);
  };
  const financeCopy = lang === "de"
    ? {
        title: "Finanzpuls",
        period: "Aktueller Monat · EUR",
        open: "Unternehmenssaldo öffnen",
        cash: "Tatsächlicher Kontostand",
        receivables: "Patientenforderungen",
        payables: "Verbindlichkeiten",
        cashFlow: "Cashflow",
        needsReview: "Abstimmung erforderlich",
        patientCount: "Patientensalden",
        unavailable: "Finanzdaten sind vorübergehend nicht verfügbar.",
      }
    : {
        title: "Финансовый пульс",
        period: "Текущий месяц · EUR",
        open: "Открыть баланс компании",
        cash: "Фактический остаток",
        receivables: "К получению от пациентов",
        payables: "К оплате провайдерам",
        cashFlow: "Чистый денежный поток",
        needsReview: "Требуется сверка",
        patientCount: "балансов пациентов",
        unavailable: "Финансовые данные временно недоступны.",
      };
  const financeMetrics = finance
    ? [
        { label: financeCopy.cash, value: finance.actual_cash_balance, icon: WalletCards, tone: "text-foreground" },
        { label: financeCopy.receivables, value: finance.patient_receivables, icon: TrendingUp, tone: "text-emerald-700 dark:text-emerald-400" },
        { label: financeCopy.payables, value: finance.provider_payables, icon: TrendingDown, tone: "text-rose-700 dark:text-rose-400" },
        { label: financeCopy.cashFlow, value: finance.net_cash_flow, icon: Landmark, tone: Number(finance.net_cash_flow) < 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400" },
      ]
    : [];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">
            {greeting}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {tr.dash_subtitle ?? tr.common_unknown}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OpenTaskQueueLink />
          <PeriodSwitcher value={period} onChange={onPeriodChange} tr={tr} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <DashKpi
          label={tr.patients_title ?? tr.common_unknown}
          value={numberOrDash(overview?.patients)}
          hint={`${activePatientCount} ${tr.common_active?.toLowerCase() ?? tr.common_unknown}`}
          icon={UsersIcon}
          onClick={onOpenPatients}
        />
        <DashKpi
          label={tr.dash_new_patients ?? tr.common_unknown}
          value={numberOrDash(newPatientsThisMonth)}
          hint={tr.dash_this_month ?? tr.common_unknown}
          icon={UserPlus}
          onClick={onOpenPatients}
        />
        <DashKpi
          label={tr.orders_title ?? tr.common_unknown}
          value={numberOrDash(overview?.orders)}
          hint={`${openTasksCount} ${(tr.dash_open_tasks ?? tr.common_unknown).toLowerCase()}`}
          icon={ClipboardList}
          onClick={onOpenOrders}
        />
      </div>

      <section className="overflow-hidden rounded-lg border border-border/70 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <CircleDollarSign className="size-4 shrink-0 text-[var(--brand)]" />
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold text-foreground">{financeCopy.title}</h2>
              <p className="text-[11px] text-muted-foreground">{financeCopy.period}</p>
            </div>
            {finance?.reconciliation_required ? (
              <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {financeCopy.needsReview} · {finance.reconciliation_patient_count} {financeCopy.patientCount}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onOpenFinance}
            className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {financeCopy.open}
            <ArrowRight className="size-3" />
          </button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {loading ? (
            Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className={cn(
                  "space-y-2 px-4 py-4",
                  index % 2 === 1 && "border-l border-border",
                  index > 1 && "border-t border-border lg:border-t-0",
                  index > 0 && "lg:border-l lg:border-border",
                )}
              >
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                <div className="h-5 w-20 animate-pulse rounded bg-muted" />
              </div>
            ))
          ) : !finance ? (
            <div className="col-span-full px-4 py-6 text-center text-[12px] text-muted-foreground">
              {financeCopy.unavailable}
            </div>
          ) : (
            financeMetrics.map((metric, index) => {
              const Icon = metric.icon;
              return (
                <button
                  key={metric.label}
                  type="button"
                  onClick={onOpenFinance}
                  className={cn(
                    "flex min-w-0 items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    index % 2 === 1 && "border-l border-border",
                    index > 1 && "border-t border-border lg:border-t-0",
                    index > 0 && "lg:border-l lg:border-border",
                  )}
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-[11px] leading-4 text-muted-foreground">{metric.label}</span>
                    <span className={cn("mt-1 block truncate text-[18px] font-semibold tabular-nums", metric.tone)}>
                      {money(metric.value)}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>

      <div className="rounded-lg border border-border/70 bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-semibold text-foreground">
              {tr.leads_title ?? tr.common_unknown} - {tr.dash_this_year ?? tr.common_unknown}
            </h3>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {tr.dash_leads_monthly_hint ?? tr.common_unknown}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={onOpenLeads}
          >
            {tr.dash_view_all ?? tr.common_unknown}
            <ArrowRight className="size-3" />
          </button>
        </div>
        <div className="min-w-0" style={{ width: "100%", height: 240 }}>
          {loading ? (
            <ChartSkeleton />
          ) : monthly.length === 0 ? (
            <EmptyChart label={tr.dash_no_data ?? tr.common_unknown} />
          ) : (
            <Suspense fallback={<ChartSkeleton />}>
              <MonthlyLeadAreaChart data={monthly} />
            </Suspense>
          )}
        </div>
      </div>
    </>
  );
}
