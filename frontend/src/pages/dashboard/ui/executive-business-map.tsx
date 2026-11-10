import { lazy, Suspense, useMemo, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowLeftRight,
  Building2,
  CalendarClock,
  ClipboardList,
  CircleCheck,
  ListTodo,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import {
  addDaysToDateKey,
  appDateKey,
  appDateKeyOf,
  appDateTimeFormat,
  formatAppDate,
  startOfMonthKey,
} from "@/lib/app-time-zone";
import { PortalDateChip } from "@/components/ui/portal-date-chip";
import { SectionHeading } from "@/components/ui/section-heading";
import { useLang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { localizeTimelineTitle } from "@/lib/timeline-labels";
import { cn } from "@/lib/utils";

import type {
  ExecutiveFinanceSnapshot,
  MonthlyEntry,
  OperationsPayload,
  OverviewStats,
  TaskItem,
  UpcomingAppointment,
} from "../model/staff-dashboard-types";

type TrendDatum = { label: string; value: number };
type CashDatum = { label: string; inflow: number; outflow: number; net: number };

const ExecutiveSparkline = lazy(async () => {
  const {
    Line,
    LineChart,
    ResponsiveContainer,
  } = await import("recharts");

  return {
    default: function ExecutiveSparkline({ data, tone }: { data: TrendDatum[]; tone: "good" | "warning" | "danger" }) {
    const stroke = tone === "danger" ? "#e11d48" : tone === "warning" ? "#f97316" : "#059669";
    return (
      <ResponsiveContainer width="100%" height={54}>
        <LineChart data={data} margin={{ top: 5, right: 3, bottom: 3, left: 3 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.6}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    );
    },
  };
});

const ExecutiveCashChart = lazy(async () => {
  const {
    Bar,
    CartesianGrid,
    ComposedChart,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
  } = await import("recharts");

  return {
    default: function ExecutiveCashChart({ data, locale, labels }: { data: CashDatum[]; locale: string; labels: { inflow: string; outflow: string; net: string } }) {
    void locale;
    // Axis ticks in whole euros, German style ("5.850 €"); the tooltip shows cents.
    const currency = new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    });
    return (
      <ResponsiveContainer width="100%" height={178}>
        <ComposedChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} fontSize={10} stroke="var(--muted-foreground)" />
          <YAxis
            axisLine={false}
            tickLine={false}
            fontSize={10}
            stroke="var(--muted-foreground)"
            tickFormatter={(value) => currency.format(Number(value))}
          />
          <Tooltip
            formatter={(value, key) => [formatMoneyAmount(Number(value), "EUR"), String(key)]}
            contentStyle={{
              background: "var(--popover)",
              color: "var(--popover-foreground)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "none",
              fontSize: 11,
            }}
          />
          <Bar dataKey="inflow" name={labels.inflow} fill="#10b981" maxBarSize={12} radius={[2, 2, 0, 0]} />
          <Bar dataKey="outflow" name={labels.outflow} fill="#fb7185" maxBarSize={12} radius={[2, 2, 0, 0]} />
          <Line
            type="monotone"
            dataKey="net"
            name={labels.net}
            stroke="var(--primary)"
            strokeWidth={1.5}
            dot={{ r: 2, fill: "var(--primary)" }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    );
    },
  };
});

const COPY = {
  ru: {
    stable: "Компания работает стабильно",
    attention: (count: number) => `${count} ${count === 1 ? "действие требует" : "действия требуют"} внимания`,
    allMetrics: "Все показатели",
    cash: "Денежные средства",
    receivables: "К получению от пациентов",
    activePatients: "Активные пациенты",
    openActions: "Открытые действия",
    money: "Деньги",
    patients: "Пациенты",
    orders: "Заказы",
    providers: "Провайдеры",
    good: "Хорошо",
    warning: "Внимание",
    danger: "Проблема",
    netFlow: "Чистый денежный поток",
    thisMonth: "Текущий месяц",
    patientCount: "Активные пациенты",
    newThisMonth: "новых в этом месяце",
    orderCount: "Открытые заказы",
    pipeline: "По текущему пайплайну",
    phases: "фаз",
    openActionsShort: "открытых действий",
    providerPayables: "К оплате провайдерам",
    network: "Активная сеть",
    providersInSelection: "провайдеров в текущей выборке",
    follow: "Следить",
    patientFinanceHint: "ожидается от пациентов",
    patientAction: "Открыть пациентов",
    orderAction: "Проверить пайплайн заказов",
    providerAction: "Открыть расчёты с провайдерами",
    moneyAction: "Открыть баланс компании",
    decisions: "Требует решения",
    noDecisions: "Срочных управленческих действий нет",
    today: "Сегодня",
    noDue: "Без срока",
    openAll: "Показать все задачи",
    cashMovement: "Движение денежных средств",
    cashHint: "Поступления, выплаты и сальдо за текущий месяц",
    inflow: "Поступления",
    outflow: "Выплаты",
    net: "Сальдо",
    milestones: "Ближайшие события",
    calendar: "Календарь",
    noEvents: "Ближайших событий нет",
    unassigned: "операций без счёта",
    reconciliation: "Нужна сверка",
    upToDate: "Сверка актуальна",
    loading: "Загрузка данных",
  },
  de: {
    stable: "Das Unternehmen arbeitet stabil",
    attention: (count: number) => `${count} offene Aktion${count === 1 ? "" : "en"} benötigen Aufmerksamkeit`,
    allMetrics: "Alle Kennzahlen",
    cash: "Zahlungsmittel",
    receivables: "Patientenforderungen",
    activePatients: "Aktive Patienten",
    openActions: "Offene Aktionen",
    money: "Finanzen",
    patients: "Patienten",
    orders: "Aufträge",
    providers: "Anbieter",
    good: "Gut",
    warning: "Achtung",
    danger: "Problem",
    netFlow: "Netto-Cashflow",
    thisMonth: "Aktueller Monat",
    patientCount: "Aktive Patienten",
    newThisMonth: "neu in diesem Monat",
    orderCount: "Offene Aufträge",
    pipeline: "Aktuelle Pipeline",
    phases: "Phasen",
    openActionsShort: "offene Aktionen",
    providerPayables: "Anbieterverbindlichkeiten",
    network: "Aktives Netzwerk",
    providersInSelection: "Anbieter in der aktuellen Auswahl",
    follow: "Beobachten",
    patientFinanceHint: "von Patienten erwartet",
    patientAction: "Patienten öffnen",
    orderAction: "Auftragspipeline prüfen",
    providerAction: "Anbieterabrechnung öffnen",
    moneyAction: "Unternehmenssaldo öffnen",
    decisions: "Entscheidung erforderlich",
    noDecisions: "Keine dringenden Management-Aktionen",
    today: "Heute",
    noDue: "Ohne Frist",
    openAll: "Alle Aufgaben anzeigen",
    cashMovement: "Cashflow-Entwicklung",
    cashHint: "Einzahlungen, Auszahlungen und Saldo im aktuellen Monat",
    inflow: "Einzahlungen",
    outflow: "Auszahlungen",
    net: "Saldo",
    milestones: "Nächste Termine",
    calendar: "Kalender",
    noEvents: "Keine anstehenden Termine",
    unassigned: "Buchungen ohne Konto",
    reconciliation: "Abstimmung nötig",
    upToDate: "Abstimmung aktuell",
    loading: "Daten werden geladen",
  },
};

function safeNumber(value: string | number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function priorityRank(priority: string) {
  if (priority === "urgent") return 0;
  if (priority === "high") return 1;
  if (priority === "medium") return 2;
  return 3;
}

function isTaskOpen(task: TaskItem) {
  return task.status !== "done" && task.status !== "completed" && task.status !== "cancelled";
}

function weeklyCashData(finance: ExecutiveFinanceSnapshot | null): CashDatum[] {
  // Seven-day buckets of the current Berlin month, as calendar dates.
  const today = appDateKey();
  const start = startOfMonthKey(today);
  const weeks = Array.from({ length: 5 }, (_, index) => {
    const from = addDaysToDateKey(start, index * 7);
    const to = addDaysToDateKey(from, 6);
    return { from, to, inflow: 0, outflow: 0, net: 0 };
  }).filter((week) => week.from <= today);

  finance?.cash_movements.forEach((movement) => {
    const date = appDateKeyOf(movement.entry_date);
    const week = weeks.find((item) => date >= item.from && date <= item.to);
    if (!week) return;
    const amount = Math.abs(safeNumber(movement.signed_amount));
    if (movement.movement === "inflow") week.inflow += amount;
    else week.outflow += amount;
    week.net += safeNumber(movement.signed_amount);
  });

  const dayMonth = (key: string) => formatAppDate(key);
  return weeks.map((week) => ({
    label: `${dayMonth(week.from)}–${dayMonth(week.to)}`,
    inflow: week.inflow,
    outflow: week.outflow,
    net: week.net,
  }));
}

function signalTone(value: number, dangerWhenPositive = false): "good" | "warning" | "danger" {
  if (dangerWhenPositive) return value > 0 ? "danger" : "good";
  if (value < 0) return "danger";
  if (value === 0) return "warning";
  return "good";
}

function ToneDot({ tone }: { tone: "good" | "warning" | "danger" }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "good" && "bg-emerald-600",
        tone === "warning" && "bg-orange-500",
        tone === "danger" && "bg-rose-600",
      )}
    />
  );
}

function MetricSignal({ label, value, note, tone }: { label: string; value: string; note: string; tone: "neutral" | "good" | "danger" }) {
  return (
    <div className="min-w-0 py-1 pr-2 sm:border-l sm:border-border sm:px-3 sm:first:border-l-0 sm:first:pl-0">
      <p className="text-[10px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-lg font-semibold leading-none tracking-tight text-foreground sm:text-[22px]">{value}</p>
      <p className={cn("mt-1.5 break-words text-xs", tone === "good" && "text-emerald-700", tone === "danger" && "text-rose-700", tone === "neutral" && "text-muted-foreground")}>{note}</p>
    </div>
  );
}

function BusinessDomain({
  action,
  chart,
  detail,
  icon,
  label,
  onClick,
  status,
  statusLabel,
  title,
  value,
}: {
  action: string;
  chart: ReactNode;
  detail: ReactNode;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  status: "good" | "warning" | "danger";
  statusLabel: string;
  title: string;
  value: string;
}) {
  return (
    <section className="staff-overview-card flex min-w-0 flex-col p-4">
      <div className="flex items-center justify-between gap-3">
        <h2><SectionHeading icon={icon}>{title}</SectionHeading></h2>
        <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ToneDot tone={status} />
          {statusLabel}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-[22px] font-semibold leading-none tracking-tight tabular-nums", status === "danger" ? "text-rose-700" : status === "warning" ? "text-orange-700" : "text-foreground")}>{value}</p>
      <div className="mt-3 h-[54px] min-w-0">{chart}</div>
      <div className="mt-2 min-h-10 border-t border-border pt-2 text-xs leading-4 text-muted-foreground">{detail}</div>
      <button type="button" onClick={onClick} className="mt-auto inline-flex items-center gap-1 self-start pt-2 text-xs font-medium text-[var(--brand)] hover:underline">
        {action}
        <ArrowRight className="size-3" />
      </button>
    </section>
  );
}

export function ExecutiveBusinessMap({
  activePatientCount,
  finance,
  greeting,
  loading,
  monthly,
  newPatientsThisMonth,
  openTasksCount,
  operations,
  overview,
  tasks,
  upcoming,
  go,
}: {
  activePatientCount: number;
  finance: ExecutiveFinanceSnapshot | null;
  greeting: string;
  loading: boolean;
  monthly: MonthlyEntry[];
  newPatientsThisMonth: number;
  openTasksCount: number;
  operations: OperationsPayload | null;
  overview: OverviewStats | null;
  tasks: TaskItem[];
  upcoming: UpcomingAppointment[];
  go: (path: string) => void;
}) {
  const { lang, t } = useLang();
  const copy = lang === "de" ? COPY.de : COPY.ru;
  const l = (key: string) =>
    t.uiText[key] ?? (t as unknown as Record<string, string>)[key] ?? key;
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  // One money style app-wide ("1.234,56 €", lib/money), whatever the language.
  const money = useMemo(
    () => ({ format: (value: number) => formatMoneyAmount(value, "EUR") }),
    [],
  );
  const today = new Date();
  const date = `${appDateTimeFormat(locale, { weekday: "long" }).format(today)}, ${formatAppDate(today)}`;

  const decisionTasks = useMemo(
    () => tasks
      .filter(isTaskOpen)
      .sort((a, b) => {
        const priority = priorityRank(a.priority) - priorityRank(b.priority);
        if (priority !== 0) return priority;
        const aDue = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY;
        const bDue = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY;
        return aDue - bDue;
      })
      .slice(0, 5),
    [tasks],
  );

  const cashData = useMemo(() => weeklyCashData(finance), [finance]);
  const netCashFlow = safeNumber(finance?.net_cash_flow);
  const receivables = safeNumber(finance?.patient_receivables);
  const payables = safeNumber(finance?.provider_payables);
  const moneyTone = signalTone(netCashFlow);
  const providerTone = signalTone(payables, true);
  const ordersTotal = overview?.orders
    ?? operations?.orders_by_phase_valued?.reduce((sum, row) => sum + row.count, 0)
    ?? 0;
  const orderTone = ordersTotal > 0 ? "warning" : "good";
  const patientTone = activePatientCount > 0 ? "good" : "warning";
  const patientTrend = monthly.map((item) => ({ label: item.month, value: item.count }));
  const orderTrend = operations?.orders_by_phase_valued?.map((item) => ({ label: item.phase, value: item.count })) ?? [];
  const providerTrend = operations?.top_providers?.slice(0, 8).map((item) => ({ label: item.name, value: item.appointment_count })) ?? [];
  const cashTrend = cashData.map((item) => ({ label: item.label, value: item.net }));

  const statusLabel = (tone: "good" | "warning" | "danger") => tone === "good" ? copy.good : tone === "warning" ? copy.warning : copy.danger;
  const taskTone = (task: TaskItem): "good" | "warning" | "danger" => {
    if (task.due_date && new Date(task.due_date).getTime() < Date.now()) return "danger";
    if (task.priority === "urgent" || task.priority === "high") return "danger";
    if (task.priority === "medium") return "warning";
    return "good";
  };

  return (
    <div className="executive-dashboard grid min-w-0 gap-3">
      <header className="staff-overview-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-foreground">{greeting}</h1>
            <p className="mt-1 text-[12px] text-muted-foreground first-letter:uppercase">{date}</p>
          </div>
          <button type="button" onClick={() => go("/reports")} className="inline-flex items-center gap-1 pt-1 text-[13px] font-medium text-[var(--brand)] hover:underline">
            {copy.allMetrics}
            <ArrowRight className="size-3" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-y-2 border-t border-border pt-3 sm:grid-cols-4">
          <MetricSignal label={copy.cash} value={loading ? "—" : money.format(safeNumber(finance?.actual_cash_balance))} note={finance?.reconciliation_required ? copy.reconciliation : copy.upToDate} tone={finance?.reconciliation_required ? "danger" : "neutral"} />
          <MetricSignal label={copy.receivables} value={loading ? "—" : money.format(receivables)} note={`${money.format(safeNumber(finance?.cash_inflow))} ${copy.inflow.toLowerCase()}`} tone={receivables > 0 ? "good" : "neutral"} />
          <MetricSignal label={copy.activePatients} value={loading ? "—" : String(activePatientCount)} note={`+${newPatientsThisMonth} ${copy.newThisMonth}`} tone={newPatientsThisMonth > 0 ? "good" : "neutral"} />
          <MetricSignal label={copy.openActions} value={loading ? "—" : String(openTasksCount)} note={openTasksCount > 0 ? copy.attention(openTasksCount) : copy.stable} tone={openTasksCount > 0 ? "danger" : "good"} />
        </div>
      </header>

      <section className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.48fr)]">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <BusinessDomain
            icon={Wallet}
            title={copy.money}
            status={moneyTone}
            statusLabel={statusLabel(moneyTone)}
            label={copy.netFlow}
            value={loading ? "—" : money.format(netCashFlow)}
            chart={<Suspense fallback={null}><ExecutiveSparkline data={cashTrend} tone={moneyTone} /></Suspense>}
            detail={<><span className="font-medium text-foreground">{copy.follow}:</span> {money.format(receivables)} {copy.patientFinanceHint}. {finance?.unassigned_movement_count ? `${finance.unassigned_movement_count} ${copy.unassigned}.` : ""}</>}
            action={copy.moneyAction}
            onClick={() => go("/company-finance")}
          />
          <BusinessDomain
            icon={UsersRound}
            title={copy.patients}
            status={patientTone}
            statusLabel={statusLabel(patientTone)}
            label={copy.patientCount}
            value={loading ? "—" : String(activePatientCount)}
            chart={<Suspense fallback={null}><ExecutiveSparkline data={patientTrend} tone={patientTone} /></Suspense>}
            detail={<><span className="font-medium text-foreground">{newPatientsThisMonth}</span> {copy.newThisMonth}; {money.format(receivables)} {copy.patientFinanceHint}.</>}
            action={copy.patientAction}
            onClick={() => go("/patients")}
          />
          <BusinessDomain
            icon={ClipboardList}
            title={copy.orders}
            status={orderTone}
            statusLabel={statusLabel(orderTone)}
            label={copy.orderCount}
            value={loading ? "—" : String(ordersTotal)}
            chart={<Suspense fallback={null}><ExecutiveSparkline data={orderTrend} tone={orderTone} /></Suspense>}
            detail={<><span className="font-medium text-foreground">{copy.pipeline}:</span> {operations?.orders_by_phase_valued?.length ?? 0} {copy.phases}, {openTasksCount} {copy.openActionsShort}.</>}
            action={copy.orderAction}
            onClick={() => go("/orders")}
          />
          <BusinessDomain
            icon={Building2}
            title={copy.providers}
            status={providerTone}
            statusLabel={statusLabel(providerTone)}
            label={copy.providerPayables}
            value={loading ? "—" : money.format(payables)}
            chart={<Suspense fallback={null}><ExecutiveSparkline data={providerTrend} tone={providerTone} /></Suspense>}
            detail={<><span className="font-medium text-foreground">{copy.network}:</span> {operations?.top_providers?.length ?? 0} {copy.providersInSelection}.</>}
            action={copy.providerAction}
            onClick={() => go("/company-finance?tab=providers")}
          />
        </div>

        <aside className="staff-overview-card min-w-0 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2><SectionHeading icon={ListTodo}>{copy.decisions}</SectionHeading></h2>
            </div>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">{decisionTasks.length}</span>
          </div>
          <div className="mt-3 divide-y divide-border">
            {loading ? (
              <div className="py-10 text-center text-[12px] text-muted-foreground">{copy.loading}</div>
            ) : decisionTasks.length === 0 ? (
              <div className="flex items-center gap-2 py-8 text-[12px] text-muted-foreground"><CircleCheck className="size-4 text-emerald-600" />{copy.noDecisions}</div>
            ) : decisionTasks.map((task, index) => {
              const tone = taskTone(task);
              return (
                <button key={task.id} type="button" onClick={() => go(`/task-manager?task=${encodeURIComponent(task.id)}`)} className="group flex w-full items-start gap-3 py-3 text-left">
                  <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold text-white", tone === "danger" && "bg-rose-600", tone === "warning" && "bg-orange-500", tone === "good" && "bg-emerald-600")}>{index + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-4 text-foreground [overflow-wrap:anywhere] group-hover:text-[var(--brand)]">{localizeTimelineTitle(task.title, l)}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {task.due_date ? <PortalDateChip timestamp={task.due_date} /> : copy.noDue}
                      {task.due_date && appDateKeyOf(task.due_date) === appDateKey() && copy.today}
                    </span>
                  </span>
                  <ArrowRight className="mt-1 size-3 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => go("/task-manager")} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline">{copy.openAll}<ArrowRight className="size-3" /></button>
        </aside>
      </section>

      {/* One shrinkable column on phones: long unbroken titles must not widen the page (QA E3-04). */}
      <section className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.75fr)]" data-testid="executive-cash-and-events">
        <div className="staff-overview-card min-w-0 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2><SectionHeading icon={ArrowLeftRight}>{copy.cashMovement}</SectionHeading></h2>
              <p className="mt-1 text-xs text-muted-foreground">{copy.cashHint}</p>
            </div>
            <button type="button" onClick={() => go("/company-finance")} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brand)] hover:underline">{copy.moneyAction}<ArrowRight className="size-3" /></button>
          </div>
          <div className="mt-2 h-[178px] min-w-0">
            <Suspense fallback={null}><ExecutiveCashChart data={cashData} locale={locale} labels={{ inflow: copy.inflow, outflow: copy.outflow, net: copy.net }} /></Suspense>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border border-t border-border pt-3 text-center">
            <div><p className="text-[10px] text-muted-foreground">{copy.inflow}</p><p className="mt-1 text-[12px] font-semibold tabular-nums text-emerald-700">{money.format(safeNumber(finance?.cash_inflow))}</p></div>
            <div><p className="text-[10px] text-muted-foreground">{copy.outflow}</p><p className="mt-1 text-[12px] font-semibold tabular-nums text-rose-700">{money.format(safeNumber(finance?.cash_outflow))}</p></div>
            <div><p className="text-[10px] text-muted-foreground">{copy.net}</p><p className="mt-1 text-[12px] font-semibold tabular-nums text-foreground">{money.format(netCashFlow)}</p></div>
          </div>
        </div>
        <div className="staff-overview-card min-w-0 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2><SectionHeading icon={CalendarClock}>{copy.milestones}</SectionHeading></h2>
            </div>
            <button type="button" onClick={() => go("/appointments")} className="shrink-0 text-xs font-medium text-[var(--brand)] hover:underline">{copy.calendar}</button>
          </div>
          <div className="mt-3 divide-y divide-border">
            {upcoming.length === 0 ? <p className="py-8 text-[12px] text-muted-foreground">{copy.noEvents}</p> : upcoming.slice(0, 5).map((appointment) => (
              <button key={appointment.id} type="button" onClick={() => go(`/appointments?appointment=${encodeURIComponent(appointment.id)}`)} className="flex w-full items-start gap-3 py-3 text-left group">
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="[overflow-wrap:anywhere] text-[13px] font-medium text-foreground group-hover:text-[var(--brand)]">{appointment.title || appointment.patient_name}</span>
                  {appointment.title && appointment.patient_name && appointment.title !== appointment.patient_name && <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{appointment.patient_name}</span>}
                  <PortalDateChip timestamp={appointment.time_start ? `${appointment.date}T${appointment.time_start}` : appointment.date} />
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
