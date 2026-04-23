import { startTransition, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  MoreHorizontal,
  Stethoscope,
  UserPlus,
  Users as UsersIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";

/* ─────────── Types ─────────── */

type OverviewStats = {
  patients: number;
  leads: number;
  orders: number;
  appointments: number;
  cases: number;
  users: number;
};
type MonthlyEntry = { month: string; count: number };
type UpcomingAppointment = {
  id: string;
  title: string;
  date: string;
  time_start?: string | null;
  type?: string | null;
  status: string;
  location?: string | null;
  patient_name: string;
};
type TaskItem = {
  id: string;
  title: string;
  description?: string | null;
  patient_id?: string | null;
  order_id?: string | null;
  appointment_id?: string | null;
  due_date?: string | null;
  priority: string;
  status: string;
};
type PatientSummary = {
  id: string;
  is_active: boolean;
  insurance_type?: string | null;
  created_at: string;
};

type DemographicsPayload = {
  period: string;
  total: number;
  by_country: Array<{ country: string; count: number }>;
  by_age_group: Array<{ group: string; count: number }>;
  by_gender: Record<string, number>;
  by_insurance: Record<string, number>;
  top_languages: Array<{ language: string; count: number }>;
};

type ClinicalPayload = {
  period: string;
  top_case_reasons: Array<{ reason: string; count: number }>;
  cases_by_status: Record<string, number>;
  service_mix: Array<{ service_type: string; item_count: number; gross_total: string }>;
  avg_case_duration_days: number;
};

type OperationsPayload = {
  period: string;
  appointments_by_status: Record<string, number>;
  appointments_heatmap: Array<{ dow: number; hour: number; count: number }>;
  orders_by_phase_valued: Array<{ phase: string; count: number; value_eur: string }>;
  top_providers: Array<{ id: string; name: string; patient_count: number; appointment_count: number }>;
};

type Period = "7d" | "30d" | "90d" | "12m" | "all";

/* ─────────── Palette ─────────── */

const PALETTE = ["#f97316", "#fb923c", "#fdba74", "#fed7aa", "#fff4ed", "#a3a3a3"];
const PERIOD_OPTIONS: Period[] = ["7d", "30d", "90d", "12m", "all"];

/* ─────────── Component ─────────── */

export function StaffDashboardPageNew() {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();

  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [monthly, setMonthly] = useState<MonthlyEntry[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingAppointment[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<Period>("30d");
  const [demographics, setDemographics] = useState<DemographicsPayload | null>(null);
  const [clinical, setClinical] = useState<ClinicalPayload | null>(null);
  const [operations, setOperations] = useState<OperationsPayload | null>(null);
  const [sectionsLoading, setSectionsLoading] = useState(true);

  function handlePeriodChange(nextPeriod: Period) {
    if (nextPeriod === period) return;
    setSectionsLoading(true);
    startTransition(() => {
      setPeriod(nextPeriod);
    });
  }

  // Static fetches (don't depend on period)
  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      apiFetch<OverviewStats>("/stats/overview").catch(() => null),
      apiFetch<MonthlyEntry[]>("/stats/leads/monthly").catch(() => [] as MonthlyEntry[]),
      apiFetch<UpcomingAppointment[]>("/stats/appointments/upcoming").catch(() => [] as UpcomingAppointment[]),
      apiFetch<TaskItem[]>("/tasks?mine_only=true").catch(() => [] as TaskItem[]),
      apiFetch<PatientSummary[]>("/patients").catch(() => [] as PatientSummary[]),
    ]).then(([ov, mm, up, tk, pts]) => {
      if (cancelled) return;
      setOverview(ov);
      setMonthly(mm);
      setUpcoming(up);
      setTasks(tk);
      setPatients(pts);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Period-dependent fetches
  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      apiFetch<DemographicsPayload>(`/stats/dashboard/demographics?period=${period}`).catch(() => null),
      apiFetch<ClinicalPayload>(`/stats/dashboard/clinical?period=${period}`).catch(() => null),
      apiFetch<OperationsPayload>(`/stats/dashboard/operations?period=${period}`).catch(() => null),
    ]).then(([d, c, o]) => {
      if (cancelled) return;
      setDemographics(d);
      setClinical(c);
      setOperations(o);
      setSectionsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [period]);

  /* ─────────── Derived ─────────── */

  const newPatientsThisMonth = useMemo(() => {
    const now = new Date();
    return patients.filter((p) => {
      const d = new Date(p.created_at);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }).length;
  }, [patients]);

  const openTasksCount = useMemo(
    () => tasks.filter((t) => t.status !== "done" && t.status !== "cancelled").length,
    [tasks]
  );

  const greeting = greetingFor(user?.name ?? "", tr);

  /* ─────────── Render ─────────── */

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground leading-tight">
            {greeting}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {tr.dash_subtitle ?? "Overview of your team's daily performance"}
          </p>
        </div>
        <PeriodSwitcher value={period} onChange={handlePeriodChange} tr={tr} />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <DashKpi
          label={tr.patients_title ?? "Patients"}
          value={numberOrDash(overview?.patients)}
          hint={`${patients.filter((p) => p.is_active).length} ${tr.common_active?.toLowerCase() ?? "active"}`}
          icon={UsersIcon}
          onClick={() => staffGo("/patients")}
        />
        <DashKpi
          label={tr.dash_new_patients ?? "New patients"}
          value={numberOrDash(newPatientsThisMonth)}
          hint={tr.dash_this_month ?? "this month"}
          icon={UserPlus}
          onClick={() => staffGo("/patients")}
        />
        <DashKpi
          label={tr.cases_title ?? "Cases"}
          value={numberOrDash(overview?.cases)}
          hint={tr.common_active?.toLowerCase() ?? "active"}
          icon={Stethoscope}
          onClick={() => staffGo("/cases")}
        />
        <DashKpi
          label={tr.orders_title ?? "Orders"}
          value={numberOrDash(overview?.orders)}
          hint={`${openTasksCount} ${(tr.dash_open_tasks ?? "open tasks").toLowerCase()}`}
          icon={ClipboardList}
          onClick={() => staffGo("/orders")}
        />
      </div>

      {/* Big area chart */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-[14px] font-semibold text-foreground">
              {tr.leads_title ?? "Leads"} · {tr.dash_this_year ?? "last 12 months"}
            </h3>
            <p className="text-[11.5px] text-muted-foreground mt-0.5">
              {tr.dash_leads_monthly_hint ?? "Monthly intake over the last year"}
            </p>
          </div>
          <button
            className="text-[12px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
            onClick={() => staffGo("/leads")}
          >
            {tr.dash_view_all ?? "View all"}
            <ArrowRight className="size-3" />
          </button>
        </div>
        <div className="min-w-0" style={{ width: "100%", height: 240 }}>
          {loading ? (
            <ChartSkeleton />
          ) : monthly.length === 0 ? (
            <EmptyChart label={tr.dash_no_data ?? "No data"} />
          ) : (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={240}>
              <AreaChart data={monthly} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
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
                <YAxis fontSize={11} tickLine={false} axisLine={false} stroke="#9ca3af" allowDecimals={false} />
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
          )}
        </div>
      </div>

      {/* ========== SECTION: Demographics ========== */}
      <SectionHeader title={tr.dash_sec_demographics ?? "Demographics"} hint={tr.dash_sec_demographics_hint ?? "Who our patients are"} />

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Countries */}
        <ChartCard
          title={tr.dash_by_country ?? "Patients by country"}
          hint={`${demographics?.total ?? 0} ${tr.patients_title?.toLowerCase() ?? "patients"}`}
        >
          <HorizontalBars
            loading={sectionsLoading}
            data={(demographics?.by_country ?? []).map((c) => ({ label: c.country, value: c.count }))}
            emptyLabel={tr.dash_no_data ?? "No data"}
          />
        </ChartCard>

        {/* Age groups */}
        <ChartCard
          title={tr.dash_by_age ?? "Age distribution"}
          hint={tr.dash_by_age_hint ?? "Patients grouped by age"}
        >
          <HorizontalBars
            loading={sectionsLoading}
            data={(demographics?.by_age_group ?? []).map((a) => ({ label: a.group, value: a.count }))}
            emptyLabel={tr.dash_no_data ?? "No data"}
            labelWidth={50}
          />
        </ChartCard>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {/* Gender donut */}
        <ChartCard title={tr.dash_by_gender ?? "Gender"} compact>
          <MiniDonut
            loading={sectionsLoading}
            data={genderToChart(demographics?.by_gender, tr)}
            emptyLabel={tr.dash_no_data ?? "No data"}
          />
        </ChartCard>

        {/* Insurance donut */}
        <ChartCard title={tr.dash_insurance_mix ?? "Insurance mix"} compact>
          <MiniDonut
            loading={sectionsLoading}
            data={insuranceToChart(demographics?.by_insurance, tr)}
            emptyLabel={tr.dash_no_data ?? "No data"}
          />
        </ChartCard>

        {/* Top languages bars */}
        <ChartCard title={tr.dash_top_languages ?? "Top languages"} compact>
          <HorizontalBars
            loading={sectionsLoading}
            data={(demographics?.top_languages ?? []).map((l) => ({ label: l.language.toUpperCase(), value: l.count }))}
            emptyLabel={tr.dash_no_data ?? "No data"}
            labelWidth={40}
            height={160}
          />
        </ChartCard>
      </div>

      {/* ========== SECTION: Clinical ========== */}
      <SectionHeader title={tr.dash_sec_clinical ?? "Clinical"} hint={tr.dash_sec_clinical_hint ?? "Case reasons, statuses and treatment patterns"} />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px] gap-4">
        {/* Top case reasons */}
        <ChartCard
          title={tr.dash_top_reasons ?? "Top case reasons"}
          hint={tr.dash_top_reasons_hint ?? "Most frequent inquiry reasons"}
        >
          <HorizontalBars
            loading={sectionsLoading}
            data={(clinical?.top_case_reasons ?? []).map((r) => ({ label: r.reason, value: r.count }))}
            emptyLabel={tr.dash_no_data ?? "No data"}
            height={240}
            labelWidth={140}
            truncate={28}
          />
        </ChartCard>

        {/* Cases by status */}
        <ChartCard title={tr.dash_cases_by_status ?? "Cases by status"} hint={tr.dash_cases_status_hint ?? "Pipeline snapshot"}>
          <MiniDonut
            loading={sectionsLoading}
            data={casesStatusToChart(clinical?.cases_by_status, tr)}
            emptyLabel={tr.dash_no_data ?? "No data"}
            height={200}
          />
        </ChartCard>

        {/* Avg case duration KPI */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col justify-between relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(circle at top right, rgba(249,115,22,0.10), transparent 55%)" }}
          />
          <div className="relative">
            <span className="text-[12px] text-muted-foreground">{tr.dash_avg_duration ?? "Avg case duration"}</span>
            <p className="mt-2 text-[30px] font-semibold tracking-tight text-foreground leading-none">
              {clinical && Number.isFinite(clinical.avg_case_duration_days)
                ? Math.round(clinical.avg_case_duration_days)
                : "—"}
            </p>
            <p className="mt-1.5 text-[12px] text-muted-foreground">{tr.dash_days ?? "days"}</p>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {tr.dash_avg_duration_hint ?? "From open to closed"}
            </p>
          </div>
        </div>
      </div>

      {/* Service mix — full-width table */}
      <ChartCard title={tr.dash_service_mix ?? "Service mix"} hint={tr.dash_service_mix_hint ?? "Procedures by volume and revenue"}>
        <ServiceMixTable loading={sectionsLoading} rows={clinical?.service_mix ?? []} tr={tr} />
      </ChartCard>

      {/* ========== SECTION: Operations ========== */}
      <SectionHeader title={tr.dash_sec_ops ?? "Operations"} hint={tr.dash_sec_ops_hint ?? "Appointments, orders and provider network"} />

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Appointments by status */}
        <ChartCard title={tr.dash_appointments_by_status ?? "Appointments by status"}>
          <MiniDonut
            loading={sectionsLoading}
            data={apptStatusToChart(operations?.appointments_by_status, tr)}
            emptyLabel={tr.dash_no_data ?? "No data"}
          />
        </ChartCard>

        {/* Orders valued */}
        <ChartCard
          title={`${tr.orders_title ?? "Orders"} · ${tr.dash_pipeline_value ?? "pipeline value"}`}
          hint={tr.dash_pipeline_hint ?? "Count and € value per phase"}
        >
          <OrdersValuedBars
            loading={sectionsLoading}
            data={operations?.orders_by_phase_valued ?? []}
            emptyLabel={tr.dash_no_data ?? "No data"}
          />
        </ChartCard>
      </div>

      {/* Heatmap */}
      <ChartCard title={tr.dash_heatmap ?? "Appointments heatmap"} hint={tr.dash_heatmap_hint ?? "Day of week × hour"}>
        <AppointmentsHeatmap loading={sectionsLoading} data={operations?.appointments_heatmap ?? []} tr={tr} />
      </ChartCard>

      {/* Top providers */}
      <ChartCard title={tr.dash_top_providers ?? "Top providers"} hint={tr.dash_top_providers_hint ?? "By appointment volume"}>
        <TopProvidersTable
          loading={sectionsLoading}
          rows={operations?.top_providers ?? []}
          tr={tr}
          onOpen={(id) => staffGo(`/providers?provider=${id}`)}
        />
      </ChartCard>

      {/* 2 columns: upcoming appointments + tasks */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Upcoming */}
        <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-muted-foreground" />
              <h3 className="text-[14px] font-semibold text-foreground">
                {tr.dash_upcoming ?? "Upcoming"}
              </h3>
            </div>
            <button
              className="text-[12px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
              onClick={() => staffGo("/appointments")}
            >
              {tr.dash_view_all ?? "View all"}
              <ArrowRight className="size-3" />
            </button>
          </div>
          <div className="divide-y divide-border">
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {tr.common_loading ?? "Loading..."}
              </div>
            ) : upcoming.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {tr.dash_no_upcoming ?? "No upcoming appointments"}
              </div>
            ) : (
              upcoming.slice(0, 6).map((apt) => (
                <button
                  key={apt.id}
                  className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-muted/40 transition-colors"
                  onClick={() => staffGo(`/appointments?appointment=${apt.id}`)}
                >
                  <div className="flex flex-col items-center justify-center shrink-0 size-10 rounded-lg bg-muted/60 text-center">
                    <span className="text-[9px] uppercase text-muted-foreground font-medium">
                      {formatMonth(apt.date)}
                    </span>
                    <span className="text-[13px] font-semibold leading-tight">
                      {formatDay(apt.date)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-foreground truncate">
                      {apt.title || apt.patient_name}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground truncate">
                      {apt.time_start ? `${apt.time_start.slice(0, 5)} · ` : ""}
                      {apt.patient_name}
                      {apt.location ? ` · ${apt.location}` : ""}
                    </div>
                  </div>
                  <StatusDot status={apt.status} />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Tasks */}
        <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-muted-foreground" />
              <h3 className="text-[14px] font-semibold text-foreground">
                {tr.dash_my_tasks ?? "My tasks"}
              </h3>
              {openTasksCount > 0 && (
                <span className="text-[11px] rounded-full bg-[var(--brand-soft)] text-[var(--brand)] px-2 py-0.5 font-medium">
                  {openTasksCount}
                </span>
              )}
            </div>
          </div>
          <div className="divide-y divide-border">
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {tr.common_loading ?? "Loading..."}
              </div>
            ) : tasks.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {tr.dash_no_tasks ?? "No tasks"}
              </div>
            ) : (
              tasks.slice(0, 6).map((task) => (
                <div
                  key={task.id}
                  className="px-4 py-2.5 flex items-start gap-3 hover:bg-muted/40 transition-colors"
                >
                  <PriorityDot priority={task.priority} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-foreground truncate">
                      {task.title}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground truncate">
                      {task.due_date ? `${tr.dash_due ?? "Due"} ${formatShortDate(task.due_date)}` : (tr.dash_no_due ?? "No deadline")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="size-7 rounded-md inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Quick links row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <QuickLink icon={UsersIcon} label={tr.patients_title ?? "Patients"} onClick={() => staffGo("/patients")} />
        <QuickLink icon={UserPlus} label={tr.leads_title ?? "Leads"} onClick={() => staffGo("/leads")} />
        <QuickLink icon={CalendarDays} label={tr.appointments_title ?? "Appointments"} onClick={() => staffGo("/appointments")} />
        <QuickLink icon={FileText} label={tr.orders_title ?? "Orders"} onClick={() => staffGo("/orders")} />
      </div>
    </div>
  );
}

/* ─────────── Helpers ─────────── */

function DashKpi({
  label,
  value,
  hint,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ElementType;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative text-left rounded-xl border border-border bg-card p-4 overflow-hidden hover:border-foreground/30 transition-colors cursor-pointer"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at top right, rgba(249,115,22,0.08), transparent 55%)",
        }}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <span className="text-[12px] text-muted-foreground">{label}</span>
          <p className="mt-1.5 text-[24px] font-semibold tracking-tight text-foreground leading-none">
            {value}
          </p>
          {hint ? (
            <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <Icon className="size-[18px] text-muted-foreground" />
      </div>
    </button>
  );
}

function QuickLink({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-foreground/30 transition-colors text-left"
    >
      <div className="flex items-center justify-center size-9 rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground truncate">{label}</div>
      </div>
      <ArrowRight className="size-3.5 text-muted-foreground" />
    </button>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === "completed" || status === "confirmed"
    ? "bg-emerald-500"
    : status === "cancelled"
      ? "bg-rose-500"
      : status === "blocked"
        ? "bg-amber-500"
        : "bg-sky-500";
  return <span className={cn("size-1.5 rounded-full shrink-0", color)} />;
}

function PriorityDot({ priority }: { priority: string }) {
  const color = priority === "high" || priority === "urgent"
    ? "bg-rose-500"
    : priority === "medium"
      ? "bg-amber-500"
      : "bg-emerald-500";
  return <span className={cn("size-1.5 rounded-full shrink-0 mt-1.5", color)} />;
}

function ChartSkeleton() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="size-8 rounded-full border-2 border-border border-t-[var(--brand)] animate-spin" />
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center text-[13px] text-muted-foreground">
      {label}
    </div>
  );
}

function greetingFor(name: string, tr: Record<string, string>) {
  const hour = new Date().getHours();
  let prefix = tr.dash_greeting ?? "Hello";
  if (hour < 12) prefix = tr.dash_greeting_morning ?? tr.dash_greeting ?? "Good morning";
  else if (hour < 18) prefix = tr.dash_greeting_afternoon ?? tr.dash_greeting ?? "Good afternoon";
  else prefix = tr.dash_greeting_evening ?? tr.dash_greeting ?? "Good evening";
  return name ? `${prefix}, ${name.split(/\s+/)[0]}` : prefix;
}

function numberOrDash(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString();
}

function formatMonth(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(iso));
  } catch {
    return iso.slice(5, 7);
  }
}

function formatDay(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(8, 10);
  }
}

function formatShortDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/* ─────────── New section helpers ─────────── */

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-end justify-between mt-2 mb-1 px-1">
      <div>
        <h2 className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
          {title}
        </h2>
        {hint && <p className="text-[13px] text-foreground mt-0.5">{hint}</p>}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  hint,
  children,
  compact,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-border bg-card", compact ? "p-3" : "p-4")}>
      <div>
        <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
        {hint && <p className="text-[11.5px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </div>
  );
}

function PeriodSwitcher({
  value,
  onChange,
  tr,
}: {
  value: Period;
  onChange: (p: Period) => void;
  tr: Record<string, string>;
}) {
  const labels: Record<Period, string> = {
    "7d": tr.dash_period_7d ?? "7d",
    "30d": tr.dash_period_30d ?? "30d",
    "90d": tr.dash_period_90d ?? "90d",
    "12m": tr.dash_period_12m ?? "12m",
    all: tr.dash_period_all ?? "All",
  };
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 text-[12px]">
      {PERIOD_OPTIONS.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={cn(
            "px-2.5 h-7 rounded-md transition-colors",
            value === opt
              ? "bg-[var(--brand)] text-white font-medium"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

function HorizontalBars({
  data,
  loading,
  emptyLabel,
  height = 220,
  labelWidth = 110,
  truncate,
}: {
  data: Array<{ label: string; value: number }>;
  loading: boolean;
  emptyLabel: string;
  height?: number;
  labelWidth?: number;
  truncate?: number;
}) {
  if (loading) return <div style={{ height }}><ChartSkeleton /></div>;
  if (data.length === 0) return <div style={{ height }}><EmptyChart label={emptyLabel} /></div>;
  const displayData = truncate
    ? data.map((d) => ({ ...d, label: d.label.length > truncate ? d.label.slice(0, truncate - 1) + "…" : d.label }))
    : data;
  return (
    <div className="min-w-0" style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={height}>
        <BarChart
          data={displayData}
          layout="vertical"
          margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
        >
          <XAxis type="number" fontSize={11} tickLine={false} axisLine={false} stroke="#9ca3af" allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="label"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            stroke="#6b7280"
            width={labelWidth}
          />
          <ChartTooltip
            contentStyle={{ borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12 }}
            cursor={{ fill: "#fafafa" }}
          />
          <Bar dataKey="value" fill="#f97316" radius={[0, 4, 4, 0]} barSize={12} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MiniDonut({
  data,
  loading,
  emptyLabel,
  height = 180,
}: {
  data: Array<{ name: string; value: number }>;
  loading: boolean;
  emptyLabel: string;
  height?: number;
}) {
  if (loading) return <div style={{ height }}><ChartSkeleton /></div>;
  const visible = data.filter((d) => d.value > 0);
  if (visible.length === 0) return <div style={{ height }}><EmptyChart label={emptyLabel} /></div>;
  return (
    <div className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-3">
      <div className="min-w-0" style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={height}>
          <PieChart>
            <Pie
              data={visible}
              dataKey="value"
              nameKey="name"
              innerRadius={45}
              outerRadius={75}
              paddingAngle={2}
              stroke="none"
            >
              {visible.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <ChartTooltip
              contentStyle={{ borderRadius: 8, border: "1px solid var(--color-border)", fontSize: 12 }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col gap-1 text-[11.5px]">
        {visible.map((entry, i) => (
          <div key={entry.name} className="flex items-center gap-2">
            <span className="inline-block size-2 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="text-muted-foreground truncate max-w-[110px]">{entry.name}</span>
            <span className="ml-auto font-medium text-foreground tabular-nums">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function genderToChart(by: Record<string, number> | undefined, tr: Record<string, string>) {
  if (!by) return [];
  return [
    { name: tr.gender_male ?? "Male", value: by.male ?? 0 },
    { name: tr.gender_female ?? "Female", value: by.female ?? 0 },
    { name: tr.gender_diverse ?? "Diverse", value: by.diverse ?? 0 },
  ];
}

function insuranceToChart(by: Record<string, number> | undefined, tr: Record<string, string>) {
  if (!by) return [];
  return [
    { name: tr.insurance_private ?? "Private", value: by.private ?? 0 },
    { name: tr.insurance_public ?? "Public", value: by.public ?? 0 },
    { name: tr.insurance_self_pay ?? "Self-pay", value: by.self_pay ?? 0 },
    { name: tr.insurance_foreign ?? "Foreign", value: by.foreign ?? 0 },
    { name: tr.common_unknown ?? "Unknown", value: by.unknown ?? 0 },
  ];
}

function casesStatusToChart(by: Record<string, number> | undefined, tr: Record<string, string>) {
  if (!by) return [];
  return [
    { name: tr.cases_open ?? "Open", value: by.open ?? 0 },
    { name: tr.cases_in_progress ?? "In progress", value: by.in_progress ?? 0 },
    { name: tr.cases_closed ?? "Closed", value: by.closed ?? 0 },
  ];
}

function apptStatusToChart(by: Record<string, number> | undefined, tr: Record<string, string>) {
  if (!by) return [];
  return [
    { name: tr.appt_planned ?? "Planned", value: by.planned ?? 0 },
    { name: tr.appt_confirmed ?? "Confirmed", value: by.confirmed ?? 0 },
    { name: tr.appt_in_progress ?? "In progress", value: by.in_progress ?? 0 },
    { name: tr.appt_completed ?? "Completed", value: by.completed ?? 0 },
    { name: tr.appt_cancelled ?? "Cancelled", value: by.cancelled ?? 0 },
  ];
}

function ServiceMixTable({
  rows,
  loading,
  tr,
}: {
  rows: Array<{ service_type: string; item_count: number; gross_total: string }>;
  loading: boolean;
  tr: Record<string, string>;
}) {
  if (loading) return <div className="py-8"><ChartSkeleton /></div>;
  if (rows.length === 0) return <EmptyChart label={tr.dash_no_data ?? "No data"} />;
  const labels: Record<string, string> = {
    medical: tr.providers_type_medical ?? "Medical",
    non_medical: tr.providers_type_non_medical ?? "Non-medical",
    cost_passthrough: tr.orders_cost_pass_through_badge ?? "Pass-through",
  };
  const max = Math.max(1, ...rows.map((r) => r.item_count));
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const pct = (r.item_count / max) * 100;
        return (
          <div key={r.service_type} className="flex items-center gap-3">
            <div className="w-[140px] text-[13px] text-foreground shrink-0">
              {labels[r.service_type] ?? r.service_type}
            </div>
            <div className="flex-1 h-2.5 bg-muted/60 rounded-full overflow-hidden">
              <div className="h-full bg-[var(--brand)] rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <div className="w-[80px] text-right text-[12px] text-muted-foreground tabular-nums shrink-0">
              {r.item_count}
            </div>
            <div className="w-[120px] text-right text-[12px] font-medium text-foreground tabular-nums shrink-0">
              € {r.gross_total}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OrdersValuedBars({
  data,
  loading,
  emptyLabel,
}: {
  data: Array<{ phase: string; count: number; value_eur: string }>;
  loading: boolean;
  emptyLabel: string;
}) {
  if (loading) return <div style={{ height: 220 }}><ChartSkeleton /></div>;
  if (data.length === 0) return <div style={{ height: 220 }}><EmptyChart label={emptyLabel} /></div>;
  const max = Math.max(1, ...data.map((d) => Number(d.value_eur) || 0));
  return (
    <div className="space-y-2.5">
      {data.map((d) => {
        const value = Number(d.value_eur) || 0;
        const pct = (value / max) * 100;
        return (
          <div key={d.phase} className="flex items-center gap-3">
            <div className="w-[100px] text-[13px] text-foreground capitalize shrink-0">{d.phase}</div>
            <div className="flex-1">
              <div className="h-5 bg-muted/50 rounded-md overflow-hidden relative">
                <div className="h-full rounded-md transition-all" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#f97316,#fb923c)" }} />
              </div>
            </div>
            <div className="w-[60px] text-right text-[11.5px] text-muted-foreground tabular-nums shrink-0">
              {d.count} ord.
            </div>
            <div className="w-[110px] text-right text-[12.5px] font-medium text-foreground tabular-nums shrink-0">
              € {Number(d.value_eur).toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AppointmentsHeatmap({
  data,
  loading,
  tr,
}: {
  data: Array<{ dow: number; hour: number; count: number }>;
  loading: boolean;
  tr: Record<string, string>;
}) {
  if (loading) return <div className="h-[200px]"><ChartSkeleton /></div>;
  if (data.length === 0) return <EmptyChart label={tr.dash_no_data ?? "No data"} />;

  const lookup = new Map<string, number>();
  let max = 0;
  for (const d of data) {
    lookup.set(`${d.dow}-${d.hour}`, d.count);
    if (d.count > max) max = d.count;
  }

  const days = [
    tr.day_mon ?? "Mon",
    tr.day_tue ?? "Tue",
    tr.day_wed ?? "Wed",
    tr.day_thu ?? "Thu",
    tr.day_fri ?? "Fri",
    tr.day_sat ?? "Sat",
    tr.day_sun ?? "Sun",
  ];
  const dowOrder = [1, 2, 3, 4, 5, 6, 0];
  const hours = Array.from({ length: 13 }, (_, i) => i + 8);

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="flex">
          <div className="w-[40px]" />
          {hours.map((h) => (
            <div key={h} className="flex-1 text-center text-[10px] text-muted-foreground tabular-nums min-w-[24px]">
              {h}
            </div>
          ))}
        </div>
        {dowOrder.map((dow, rowIdx) => (
          <div key={dow} className="flex items-center mt-1">
            <div className="w-[40px] text-[11px] text-muted-foreground pr-2 text-right">
              {days[rowIdx]}
            </div>
            {hours.map((h) => {
              const v = lookup.get(`${dow}-${h}`) ?? 0;
              const intensity = max > 0 ? v / max : 0;
              const bg = intensity === 0
                ? "transparent"
                : `rgba(249,115,22,${0.08 + intensity * 0.72})`;
              return (
                <div
                  key={h}
                  title={v > 0 ? `${days[rowIdx]} ${h}:00 — ${v}` : undefined}
                  className="flex-1 rounded-sm aspect-square mx-0.5 min-w-[22px] min-h-[22px] flex items-center justify-center text-[10px] text-foreground/60"
                  style={{
                    background: bg,
                    border: intensity === 0 ? "1px solid var(--color-border)" : "none",
                  }}
                >
                  {v > 0 && intensity > 0.4 ? v : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function TopProvidersTable({
  rows,
  loading,
  tr,
  onOpen,
}: {
  rows: Array<{ id: string; name: string; patient_count: number; appointment_count: number }>;
  loading: boolean;
  tr: Record<string, string>;
  onOpen: (id: string) => void;
}) {
  if (loading) return <div className="py-6"><ChartSkeleton /></div>;
  if (rows.length === 0) return <EmptyChart label={tr.dash_no_data ?? "No data"} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="pb-2 font-medium">#</th>
            <th className="pb-2 font-medium">{tr.providers_title ?? "Provider"}</th>
            <th className="pb-2 font-medium text-right">{tr.patients_title ?? "Patients"}</th>
            <th className="pb-2 font-medium text-right">{tr.appointments_title ?? "Appointments"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={row.id}
              className="border-t border-border hover:bg-muted/40 cursor-pointer transition-colors"
              onClick={() => onOpen(row.id)}
            >
              <td className="py-2 text-muted-foreground font-mono text-[12px] w-10">{idx + 1}</td>
              <td className="py-2 font-medium text-foreground">{row.name}</td>
              <td className="py-2 text-right tabular-nums">{row.patient_count}</td>
              <td className="py-2 text-right tabular-nums">{row.appointment_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
