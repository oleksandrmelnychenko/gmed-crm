import { lazy, Suspense, useMemo, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  CircleCheck,
  Clock3,
} from "lucide-react";

import { useLang } from "@/lib/i18n";
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
    const currency = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    });
    return (
      <ResponsiveContainer width="100%" height={178}>
        <ComposedChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="#e5e7eb" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} fontSize={10} stroke="#8b8b8b" />
          <YAxis
            axisLine={false}
            tickLine={false}
            fontSize={10}
            stroke="#8b8b8b"
            tickFormatter={(value) => currency.format(Number(value))}
          />
          <Tooltip
            formatter={(value, key) => [currency.format(Number(value)), String(key)]}
            contentStyle={{
              border: "1px solid #e5e7eb",
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
            stroke="#171717"
            strokeWidth={1.5}
            dot={{ r: 2, fill: "#171717" }}
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
    taskQueue: "Очередь управленческих действий",
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
    analytics: "Перейти к аналитике",
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
    taskQueue: "Management-Aktionsliste",
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
    analytics: "Zur Analyse",
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

function weeklyCashData(finance: ExecutiveFinanceSnapshot | null, locale: string): CashDatum[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const weeks = Array.from({ length: 5 }, (_, index) => {
    const from = new Date(start);
    from.setDate(1 + index * 7);
    const to = new Date(from);
    to.setDate(from.getDate() + 6);
    return { from, to, inflow: 0, outflow: 0, net: 0 };
  }).filter((week) => week.from <= now);

  finance?.cash_movements.forEach((movement) => {
    const date = new Date(`${movement.entry_date}T12:00:00`);
    const week = weeks.find((item) => date >= item.from && date <= item.to);
    if (!week) return;
    const amount = Math.abs(safeNumber(movement.signed_amount));
    if (movement.movement === "inflow") week.inflow += amount;
    else week.outflow += amount;
    week.net += safeNumber(movement.signed_amount);
  });

  const dayMonth = new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" });
  return weeks.map((week) => ({
    label: `${dayMonth.format(week.from)}–${dayMonth.format(week.to)}`,
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
    <div className="min-w-0 px-4 py-3 first:pl-0 last:pr-0 sm:border-l sm:border-border sm:first:border-l-0">
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[22px] font-semibold leading-none tracking-tight text-foreground">{value}</p>
      <p className={cn("mt-1.5 truncate text-[10.5px]", tone === "good" && "text-emerald-700", tone === "danger" && "text-rose-700", tone === "neutral" && "text-muted-foreground")}>{note}</p>
    </div>
  );
}

function BusinessDomain({
  action,
  chart,
  detail,
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
  label: string;
  onClick: () => void;
  status: "good" | "warning" | "danger";
  statusLabel: string;
  title: string;
  value: string;
}) {
  return (
    <section className="flex min-h-[220px] min-w-0 flex-col px-4 py-4 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">{title}</h2>
        <div className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <ToneDot tone={status} />
          {statusLabel}
        </div>
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-[22px] font-semibold leading-none tracking-tight tabular-nums", status === "danger" ? "text-rose-700" : status === "warning" ? "text-orange-700" : "text-foreground")}>{value}</p>
      <div className="mt-3 h-[54px] min-w-0">{chart}</div>
      <div className="mt-2 min-h-10 border-t border-border pt-2 text-[10.5px] leading-4 text-muted-foreground">{detail}</div>
      <button type="button" onClick={onClick} className="mt-auto inline-flex items-center gap-1 self-start pt-2 text-[11px] font-medium text-[var(--brand)] hover:underline">
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
  const money = useMemo(
    () => new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    [locale],
  );
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

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

  const cashData = useMemo(() => weeklyCashData(finance, locale), [finance, locale]);
  const netCashFlow = safeNumber(finance?.net_cash_flow);
  const receivables = safeNumber(finance?.patient_receivables);
  const payables = safeNumber(finance?.provider_payables);
  const moneyTone = signalTone(netCashFlow);
  const providerTone = signalTone(payables, true);
  const ordersTotal = overview?.orders
    ?? operations?.orders_by_phase_valued.reduce((sum, row) => sum + row.count, 0)
    ?? 0;
  const orderTone = ordersTotal > 0 ? "warning" : "good";
  const patientTone = activePatientCount > 0 ? "good" : "warning";
  const patientTrend = monthly.map((item) => ({ label: item.month, value: item.count }));
  const orderTrend = operations?.orders_by_phase_valued.map((item) => ({ label: item.phase, value: item.count })) ?? [];
  const providerTrend = operations?.top_providers.slice(0, 8).map((item) => ({ label: item.name, value: item.appointment_count })) ?? [];
  const cashTrend = cashData.map((item) => ({ label: item.label, value: item.net }));

  const statusLabel = (tone: "good" | "warning" | "danger") => tone === "good" ? copy.good : tone === "warning" ? copy.warning : copy.danger;
  const dueLabel = (task: TaskItem) => {
    if (!task.due_date) return copy.noDue;
    const due = new Date(task.due_date);
    const today = new Date();
    const sameDay = due.toDateString() === today.toDateString();
    return sameDay ? copy.today : new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(due);
  };
  const taskTone = (task: TaskItem): "good" | "warning" | "danger" => {
    if (task.due_date && new Date(task.due_date).getTime() < Date.now()) return "danger";
    if (task.priority === "urgent" || task.priority === "high") return "danger";
    if (task.priority === "medium") return "warning";
    return "good";
  };

  return (
    <div className="space-y-0 pb-6">
      <header className="border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-foreground">{greeting}</h1>
            <p className="mt-1 text-[12px] capitalize text-muted-foreground">{date}</p>
          </div>
          <button type="button" onClick={() => go("/reports")} className="inline-flex items-center gap-1 pt-1 text-[11.5px] font-medium text-[var(--brand)] hover:underline">
            {copy.allMetrics}
            <ArrowRight className="size-3" />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
          {openTasksCount > 0 ? <CircleAlert className="size-4 text-orange-500" /> : <CircleCheck className="size-4 text-emerald-600" />}
          <span className="font-medium text-foreground">{openTasksCount > 0 ? copy.attention(openTasksCount) : copy.stable}</span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">{copy.stable}</span>
        </div>
      </header>

      <section className="grid grid-cols-2 border-b border-border py-1 sm:grid-cols-4">
        <MetricSignal label={copy.cash} value={loading ? "—" : money.format(safeNumber(finance?.actual_cash_balance))} note={finance?.reconciliation_required ? copy.reconciliation : copy.upToDate} tone={finance?.reconciliation_required ? "danger" : "neutral"} />
        <MetricSignal label={copy.receivables} value={loading ? "—" : money.format(receivables)} note={`${money.format(safeNumber(finance?.cash_inflow))} ${copy.inflow.toLowerCase()}`} tone={receivables > 0 ? "good" : "neutral"} />
        <MetricSignal label={copy.activePatients} value={loading ? "—" : String(activePatientCount)} note={`+${newPatientsThisMonth} ${copy.newThisMonth}`} tone={newPatientsThisMonth > 0 ? "good" : "neutral"} />
        <MetricSignal label={copy.openActions} value={loading ? "—" : String(openTasksCount)} note={openTasksCount > 0 ? copy.attention(openTasksCount) : copy.stable} tone={openTasksCount > 0 ? "danger" : "good"} />
      </section>

      <section className="grid border-b border-border xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="grid min-w-0 sm:grid-cols-2">
          <div className="border-b border-border">
            <BusinessDomain
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
          </div>
          <div className="border-b border-border sm:border-l">
            <BusinessDomain
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
          </div>
          <div className="border-b border-border sm:border-b-0">
            <BusinessDomain
              title={copy.orders}
              status={orderTone}
              statusLabel={statusLabel(orderTone)}
              label={copy.orderCount}
              value={loading ? "—" : String(ordersTotal)}
              chart={<Suspense fallback={null}><ExecutiveSparkline data={orderTrend} tone={orderTone} /></Suspense>}
              detail={<><span className="font-medium text-foreground">{copy.pipeline}:</span> {operations?.orders_by_phase_valued.length ?? 0} {copy.phases}, {openTasksCount} {copy.openActionsShort}.</>}
              action={copy.orderAction}
              onClick={() => go("/orders")}
            />
          </div>
          <div className="sm:border-l">
            <BusinessDomain
              title={copy.providers}
              status={providerTone}
              statusLabel={statusLabel(providerTone)}
              label={copy.providerPayables}
              value={loading ? "—" : money.format(payables)}
              chart={<Suspense fallback={null}><ExecutiveSparkline data={providerTrend} tone={providerTone} /></Suspense>}
              detail={<><span className="font-medium text-foreground">{copy.network}:</span> {operations?.top_providers.length ?? 0} {copy.providersInSelection}.</>}
              action={copy.providerAction}
              onClick={() => go("/company-finance?tab=providers")}
            />
          </div>
        </div>

        <aside className="border-t border-border px-4 py-4 sm:px-5 xl:border-l xl:border-t-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">{copy.decisions}</h2>
              <p className="mt-1 text-[10.5px] text-muted-foreground">{copy.taskQueue}</p>
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
                    <span className="block break-words text-[11.5px] font-medium leading-4 text-foreground group-hover:text-[var(--brand)]">{localizeTimelineTitle(task.title, l)}</span>
                    <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><Clock3 className="size-3" />{dueLabel(task)}</span>
                  </span>
                  <ArrowRight className="mt-1 size-3 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => go("/task-manager")} className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--brand)] hover:underline">{copy.openAll}<ArrowRight className="size-3" /></button>
        </aside>
      </section>

      <section className="grid border-b border-border lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.75fr)] lg:divide-x lg:divide-border">
        <div className="min-w-0 px-0 py-4 lg:pr-5">
          <div className="flex items-start justify-between gap-3 px-4 lg:px-0">
            <div>
              <h2 className="text-[13px] font-semibold text-foreground">{copy.cashMovement}</h2>
              <p className="mt-1 text-[10.5px] text-muted-foreground">{copy.cashHint}</p>
            </div>
            <button type="button" onClick={() => go("/company-finance")} className="inline-flex items-center gap-1 text-[10.5px] font-medium text-[var(--brand)] hover:underline">{copy.moneyAction}<ArrowRight className="size-3" /></button>
          </div>
          <div className="mt-2 h-[178px] min-w-0">
            <Suspense fallback={null}><ExecutiveCashChart data={cashData} locale={locale} labels={{ inflow: copy.inflow, outflow: copy.outflow, net: copy.net }} /></Suspense>
          </div>
          <div className="grid grid-cols-3 divide-x divide-border border-t border-border px-4 pt-3 text-center lg:px-0">
            <div><p className="text-[10px] text-muted-foreground">{copy.inflow}</p><p className="mt-1 text-[12px] font-semibold tabular-nums text-emerald-700">{money.format(safeNumber(finance?.cash_inflow))}</p></div>
            <div><p className="text-[10px] text-muted-foreground">{copy.outflow}</p><p className="mt-1 text-[12px] font-semibold tabular-nums text-rose-700">{money.format(safeNumber(finance?.cash_outflow))}</p></div>
            <div><p className="text-[10px] text-muted-foreground">{copy.net}</p><p className="mt-1 text-[12px] font-semibold tabular-nums text-foreground">{money.format(netCashFlow)}</p></div>
          </div>
        </div>
        <div className="px-4 py-4 lg:pl-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold text-foreground">{copy.milestones}</h2>
              <p className="mt-1 text-[10.5px] text-muted-foreground">{copy.calendar}</p>
            </div>
            <button type="button" onClick={() => go("/appointments")} className="text-[10.5px] font-medium text-[var(--brand)] hover:underline">{copy.calendar}</button>
          </div>
          <div className="mt-3 divide-y divide-border">
            {upcoming.length === 0 ? <p className="py-8 text-[12px] text-muted-foreground">{copy.noEvents}</p> : upcoming.slice(0, 5).map((appointment) => (
              <button key={appointment.id} type="button" onClick={() => go(`/appointments?appointment=${encodeURIComponent(appointment.id)}`)} className="flex w-full items-start gap-3 py-3 text-left group">
                <span className="flex size-8 shrink-0 flex-col items-center justify-center border-r border-border pr-2 text-center">
                  <span className="text-[9px] uppercase text-muted-foreground">{new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(appointment.date))}</span>
                  <span className="text-[12px] font-semibold text-foreground">{new Intl.DateTimeFormat(locale, { day: "2-digit" }).format(new Date(appointment.date))}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium text-foreground group-hover:text-[var(--brand)]">{appointment.title || appointment.patient_name}</span>
                  <span className="mt-1 block truncate text-[10px] text-muted-foreground">{appointment.time_start?.slice(0, 5) ?? "—"} · {appointment.patient_name}</span>
                </span>
                <CalendarDays className="mt-1 size-3 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="flex justify-end pt-4">
        <button type="button" onClick={() => go("/reports")} className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--brand)] hover:underline">{copy.analytics}<ArrowRight className="size-3" /></button>
      </div>
    </div>
  );
}
