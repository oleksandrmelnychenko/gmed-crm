import { startTransition, useEffect, useMemo, useState, type ElementType } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  BriefcaseMedical,
  Building2,
  CalendarDays,
  FileText,
  LoaderCircle,
  RefreshCw,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { PatientDashboardPage } from "@/pages/patient-dashboard";
import { npsBandLabel, type PortalFeedbackSummary } from "@/pages/patient-portal.shared";
import { cn } from "@/lib/utils";

type OverviewStats = { patients: number; leads: number; orders: number; appointments: number; cases: number; users: number };
type LeadsStats = { total_this_month: number; growth_pct: number; qualified_this_month: number; converted_this_month: number; total_all: number };
type MonthlyEntry = { month: string; count: number };
type OrderPhaseEntry = { phase: string; count: number };
type UpcomingAppointment = { id: string; title: string; date: string; time_start?: string | null; type?: string | null; status: string; location?: string | null; patient_name: string };
type TaskItem = { id: string; title: string; description?: string | null; patient_id?: string | null; order_id?: string | null; appointment_id?: string | null; due_date?: string | null; priority: string; status: string };
type NotificationItem = { id: string; title: string; body?: string | null; entity_type?: string | null; entity_id?: string | null; is_read: boolean; created_at: string };
type CeoSummary = {
  invoiced_this_month: string;
  collected_this_month: string;
  invoiced_this_quarter: string;
  outstanding_receivables: string;
  average_revenue_per_patient: string;
  on_time_payment_rate_pct: number;
  new_patients_this_month: number;
  active_patients_total: number;
  active_patients_under_care: number;
  returning_patients: number;
  patients_with_orders: number;
  retention_rate_pct: number;
  retention_definition: string;
};
type CeoCountryEntry = { country: string; patient_count: number };
type CeoServiceMixEntry = { service_type: string; item_count: number; gross_total: string };
type CeoPatientManagerKpi = {
  user_id: string;
  name: string;
  active_patients: number;
  active_orders: number;
  open_tasks: number;
  overdue_tasks: number;
  checklist_total: number;
  checklist_completed: number;
  checklist_completion_rate_pct: number;
  avg_feedback_score?: number | null;
};
type CeoInterpreterKpi = {
  user_id: string;
  name: string;
  approved_hours_30d: string;
  booked_hours_30d: string;
  upcoming_hours_30d: string;
  completed_appointments_30d: number;
  utilization_rate_pct: number;
  avg_feedback_score?: number | null;
};
type CeoConciergeKpi = {
  user_id: string;
  name: string;
  active_services: number;
  completed_services_30d: number;
  ready_for_billing: number;
  portal_requests_30d: number;
  avg_feedback_score?: number | null;
};
type CeoProviderKpi = {
  provider_id: string;
  name: string;
  active_patients_90d: number;
  appointments_90d: number;
  gross_service_volume: string;
  avg_feedback_score?: number | null;
};
type CeoDashboardPayload = {
  summary: CeoSummary;
  countries: CeoCountryEntry[];
  service_mix: CeoServiceMixEntry[];
  patient_manager_kpis: CeoPatientManagerKpi[];
  interpreter_kpis: CeoInterpreterKpi[];
  concierge_kpis: CeoConciergeKpi[];
  provider_kpis: CeoProviderKpi[];
};
type RiskSeverity = "medium" | "high" | "urgent";
type PatientManagerRiskSummary = {
  total_alerts: number;
  urgent_alerts: number;
  high_alerts: number;
  medium_alerts: number;
  complex_case_alerts: number;
  overdue_appointments: number;
  overdue_tasks: number;
  overdue_checklists: number;
};
type PatientManagerRiskAlert = {
  patient_id: string;
  patient_label: string;
  severity: RiskSeverity;
  title: string;
  reasons: string[];
  open_case_count: number;
  open_appointment_count: number;
  overdue_appointment_count: number;
  open_task_count: number;
  overdue_task_count: number;
  overdue_checklist_count: number;
  high_risk_label: boolean;
  fall_risk_label: boolean;
};
type BillingRiskSummary = {
  total_alerts: number;
  urgent_alerts: number;
  high_alerts: number;
  medium_alerts: number;
  overdue_invoice_count: number;
  blocked_orders: number;
  outstanding_balance_total: string;
  exposure_gap_total: string;
};
type BillingRiskAlert = {
  order_id: string;
  order_number: string;
  patient_id: string;
  patient_label: string;
  severity: RiskSeverity;
  title: string;
  reasons: string[];
  phase: string;
  billing_release_status: string;
  package_coverage_status: string;
  overdue_invoice_count: number;
  unpaid_advance_invoice_count: number;
  outstanding_balance: string;
  service_gross: string;
  invoiced_total: string;
  exposure_gap: string;
};
type RiskAnalysisPayload = {
  allowed_sections: string[];
  patient_manager: { summary: PatientManagerRiskSummary; alerts: PatientManagerRiskAlert[] } | null;
  billing: { summary: BillingRiskSummary; alerts: BillingRiskAlert[] } | null;
};
type ForecastingPayload = {
  summary: {
    open_quotes: number;
    expiring_quotes_next_14d: number;
    pipeline_gross_total?: string | null;
    weighted_pipeline_gross?: string | null;
    due_next_14d_total?: string | null;
    overdue_open_total?: string | null;
    followup_milestones_next_30d: number;
    appointments_next_30d: number;
  };
  allowed_sections: string[];
};
type MyKpiPayload =
  | { section: "patient_manager"; kpi: CeoPatientManagerKpi | null }
  | { section: "interpreter"; kpi: CeoInterpreterKpi | null }
  | { section: "concierge"; kpi: CeoConciergeKpi | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function card(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]",
    extra
  );
}

function metricCard(label: string, value: string | number, icon: ElementType) {
  const Icon = icon;
  return (
    <article className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <span className="rounded-2xl bg-slate-100 p-2 text-slate-700">
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
    </article>
  );
}

function roleLabel(role: string, tr: Record<string, string>) {
  return tr[`role_${role}`] ?? role.replaceAll("_", " ");
}

function formatMoney(value?: string | number | null) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function formatCompactNumber(value?: string | number | null, suffix = "") {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  if (Math.abs(safeValue) >= 1000) {
    return `${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(safeValue)}${suffix}`;
  }
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(safeValue)}${suffix}`;
}

function formatRating(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "Not rated";
  return `${value.toFixed(1)}/5`;
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

function riskTone(severity: RiskSeverity) {
  if (severity === "urgent") return "border-rose-200 bg-rose-50 text-rose-700";
  if (severity === "high") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function serviceTypeLabel(value: string) {
  if (value === "medical") return "Medical";
  if (value === "non_medical") return "Non-medical";
  if (value === "cost_passthrough") return "Cost passthrough";
  return value.replaceAll("_", " ");
}

function fmtDate(value?: string | null, withTime = false) {
  if (!value) return "Not set";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function dueLabel(value?: string | null) {
  if (!value) return "No due date";
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(value);
  due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - now.getTime()) / 86_400_000);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  return `Due in ${diff}d`;
}

function notificationHref(item: NotificationItem) {
  if (!item.entity_id || !item.entity_type) return null;
  if (item.entity_type === "message_peer") return `/chat?peer=${item.entity_id}`;
  if (item.entity_type === "lead") return `/leads?lead=${item.entity_id}`;
  if (item.entity_type === "patient") return `/patients?patient=${item.entity_id}`;
  if (item.entity_type === "provider") return `/providers?provider=${item.entity_id}`;
  if (item.entity_type === "order") return `/orders?order=${item.entity_id}`;
  if (item.entity_type === "appointment") return `/appointments?appointment=${item.entity_id}`;
  if (item.entity_type === "case") return `/cases?case=${item.entity_id}`;
  return null;
}

function taskHref(item: TaskItem) {
  if (item.appointment_id) return `/appointments?appointment=${item.appointment_id}`;
  if (item.order_id) return `/orders?order=${item.order_id}`;
  if (item.patient_id) return `/patients/${item.patient_id}?tab=workflow`;
  return null;
}

export function DashboardPage() {
  const { user } = useAuth();

  if (user?.role === "patient") {
    return <PatientDashboardPage />;
  }

  return <StaffDashboardPage />;
}

function StaffDashboardPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const navigate = useNavigate();
  const role = user?.role ?? "";
  const executive = role === "ceo" || role === "ceo_assistant";

  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [leadsStats, setLeadsStats] = useState<LeadsStats | null>(null);
  const [monthly, setMonthly] = useState<MonthlyEntry[]>([]);
  const [orderPhases, setOrderPhases] = useState<OrderPhaseEntry[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingAppointment[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [ceoDashboard, setCeoDashboard] = useState<CeoDashboardPayload | null>(null);
  const [myKpis, setMyKpis] = useState<MyKpiPayload | null>(null);
  const [forecasting, setForecasting] = useState<ForecastingPayload | null>(null);
  const [riskAnalysis, setRiskAnalysis] = useState<RiskAnalysisPayload | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState<PortalFeedbackSummary | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const canOverview = executive || role === "patient_manager" || role === "billing" || role === "sales";
  const canLeads = executive || role === "patient_manager" || role === "sales";
  const canOrders = executive || role === "patient_manager" || role === "billing";
  const canUpcoming = executive || role === "patient_manager" || role === "teamlead_interpreter";
  const canRiskAnalysis = executive || role === "patient_manager" || role === "billing";
  const canMyKpis =
    role === "patient_manager" ||
    role === "teamlead_interpreter" ||
    role === "interpreter" ||
    role === "concierge";
  const canTasks =
    role === "ceo" ||
    role === "patient_manager" ||
    role === "teamlead_interpreter" ||
    role === "interpreter" ||
    role === "concierge" ||
    role === "billing";

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }
      const [ov, ls, mo, op, up, ta, no, executiveDashboard, ownKpis, executiveForecasting, riskSignals, executiveFeedback] = await Promise.all([
        canOverview ? apiFetch<OverviewStats>("/stats/overview").catch(() => null) : Promise.resolve(null),
        canLeads ? apiFetch<LeadsStats>("/stats/leads").catch(() => null) : Promise.resolve(null),
        canLeads ? apiFetch<MonthlyEntry[]>("/stats/leads/monthly").catch(() => []) : Promise.resolve([]),
        canOrders ? apiFetch<OrderPhaseEntry[]>("/stats/orders/by-phase").catch(() => []) : Promise.resolve([]),
        canUpcoming ? apiFetch<UpcomingAppointment[]>("/stats/appointments/upcoming").catch(() => []) : Promise.resolve([]),
        canTasks ? apiFetch<TaskItem[]>("/tasks?mine_only=true").catch(() => []) : Promise.resolve([]),
        apiFetch<NotificationItem[]>("/notifications").catch(() => []),
        executive ? apiFetch<CeoDashboardPayload>("/stats/ceo/dashboard").catch(() => null) : Promise.resolve(null),
        canMyKpis ? apiFetch<MyKpiPayload>("/stats/my-kpis").catch(() => null) : Promise.resolve(null),
        executive ? apiFetch<ForecastingPayload>("/stats/forecasting").catch(() => null) : Promise.resolve(null),
        canRiskAnalysis ? apiFetch<RiskAnalysisPayload>("/stats/risk-analysis").catch(() => null) : Promise.resolve(null),
        executive ? apiFetch<PortalFeedbackSummary>("/feedback/summary").catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      startTransition(() => {
        setOverview(ov);
        setLeadsStats(ls);
        setMonthly(mo);
        setOrderPhases(op);
        setUpcoming(up);
        setTasks(ta);
        setNotifications(no);
        setCeoDashboard(executiveDashboard);
        setMyKpis(ownKpis);
        setForecasting(executiveForecasting);
        setRiskAnalysis(riskSignals);
        setFeedbackSummary(executiveFeedback);
      });
      setLoading(false);
      setRefreshing(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [canLeads, canMyKpis, canOrders, canOverview, canRiskAnalysis, canTasks, canUpcoming, executive, loading, user, version]);

  const activeTasks = useMemo(
    () => tasks.filter((item) => item.status !== "completed" && item.status !== "cancelled"),
    [tasks]
  );
  const unread = useMemo(() => notifications.filter((item) => !item.is_read).slice(0, 5), [notifications]);
  const bars = useMemo(
    () =>
      MONTHS.map((label, index) => {
        const key = String(index + 1).padStart(2, "0");
        return { label, count: monthly.find((item) => item.month.endsWith(`-${key}`))?.count ?? 0 };
      }),
    [monthly]
  );
  const maxBar = useMemo(() => Math.max(1, ...bars.map((item) => item.count)), [bars]);
  const metrics = useMemo(
    () =>
      overview
        ? [
            { label: t.dash_total_patients, value: overview.patients, href: "/patients", icon: Users, tone: "bg-sky-100 text-sky-700" },
            { label: t.dash_total_visitors, value: overview.leads, href: "/leads", icon: UserPlus, tone: "bg-violet-100 text-violet-700" },
            { label: t.orders_title, value: overview.orders, href: "/orders", icon: FileText, tone: "bg-amber-100 text-amber-700" },
            { label: t.dash_total_appointments, value: overview.appointments, href: "/appointments", icon: CalendarDays, tone: "bg-emerald-100 text-emerald-700" },
            { label: t.cases_title, value: overview.cases, href: "/cases", icon: BriefcaseMedical, tone: "bg-slate-100 text-slate-700" },
            { label: t.users_title, value: overview.users, href: "/admin/users", icon: Building2, tone: "bg-slate-100 text-slate-700" },
          ]
        : [],
    [overview, t]
  );
  const executiveMetrics = useMemo(
    () =>
      ceoDashboard
        ? [
            {
              label: "Invoiced this month",
              value: formatMoney(ceoDashboard.summary.invoiced_this_month),
              caption: `${formatMoney(ceoDashboard.summary.collected_this_month)} collected`,
              tone: "border-sky-200 bg-sky-50",
            },
            {
              label: "Outstanding receivables",
              value: formatMoney(ceoDashboard.summary.outstanding_receivables),
              caption: `${formatPercent(ceoDashboard.summary.on_time_payment_rate_pct)} paid on time`,
              tone: "border-amber-200 bg-amber-50",
            },
            {
              label: "Active patients under care",
              value: String(ceoDashboard.summary.active_patients_under_care),
              caption: `${ceoDashboard.summary.new_patients_this_month} new this month`,
              tone: "border-emerald-200 bg-emerald-50",
            },
            {
              label: "Patient retention",
              value: formatPercent(ceoDashboard.summary.retention_rate_pct),
              caption: `${ceoDashboard.summary.returning_patients}/${ceoDashboard.summary.patients_with_orders} returning patients`,
              tone: "border-violet-200 bg-violet-50",
            },
            {
              label: "Average revenue per patient",
              value: formatMoney(ceoDashboard.summary.average_revenue_per_patient),
              caption: `${formatMoney(ceoDashboard.summary.invoiced_this_quarter)} quarter volume`,
              tone: "border-rose-200 bg-rose-50",
            },
            {
              label: "NPS",
              value: feedbackSummary ? String(feedbackSummary.nps_score) : "0",
              caption: feedbackSummary ? npsBandLabel(feedbackSummary.nps_score) : "No feedback yet",
              tone: "border-slate-200 bg-slate-50",
            },
          ]
        : [],
    [ceoDashboard, feedbackSummary]
  );
  const executiveForecastMetrics = useMemo(
    () =>
      forecasting
        ? [
            {
              label: "Open quote pipeline",
              value: String(forecasting.summary.open_quotes),
              caption: forecasting.summary.pipeline_gross_total
                ? formatMoney(forecasting.summary.pipeline_gross_total)
                : `${forecasting.summary.expiring_quotes_next_14d} expiring / 14d`,
            },
            {
              label: "Weighted pipeline",
              value: forecasting.summary.weighted_pipeline_gross
                ? formatMoney(forecasting.summary.weighted_pipeline_gross)
                : "Counts only",
              caption: `${forecasting.summary.expiring_quotes_next_14d} expiring within 14 days`,
            },
            {
              label: "Collections due soon",
              value: forecasting.summary.due_next_14d_total
                ? formatMoney(forecasting.summary.due_next_14d_total)
                : "Not visible",
              caption: forecasting.summary.overdue_open_total
                ? `${formatMoney(forecasting.summary.overdue_open_total)} overdue`
                : "No financial forecast for this role",
            },
            {
              label: "Follow-up + clinic load",
              value: `${forecasting.summary.followup_milestones_next_30d}`,
              caption: `${forecasting.summary.appointments_next_30d} appointments in the next 30 days`,
            },
          ]
        : [],
    [forecasting]
  );
  const patientManagerRisk = riskAnalysis?.patient_manager ?? null;
  const billingRisk = riskAnalysis?.billing ?? null;

  async function updateTask(taskId: string, status: "in_progress" | "completed") {
    setBusyTaskId(taskId);
    try {
      await apiFetch(`/tasks/${taskId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      setVersion((value) => value + 1);
    } finally {
      setBusyTaskId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {t.common_loading}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className={card("bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_32%),linear-gradient(135deg,#0f172a_0%,#111827_54%,#1e293b_100%)] px-6 py-6 text-white")}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/55">{t.nav_dashboard}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {t.dash_greeting}, {user?.name ?? "GMED"}
            </h1>
            <p className="mt-3 text-sm leading-7 text-white/70">
              Operational cockpit for {roleLabel(role, tr)} with live queue, pipeline and appointment signals.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/appointments">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">Open calendar</Button>
            </Link>
            <Link to="/patients">
              <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white">Patients</Button>
            </Link>
            <Button variant="outline" className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white" onClick={() => setVersion((value) => value + 1)}>
              <RefreshCw className={cn("mr-2 size-4", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      {metrics.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {metrics.map((item) => (
            <Link key={item.label} to={item.href} className="rounded-[1.5rem] border border-white/90 bg-white/88 p-4 shadow-sm backdrop-blur transition-transform duration-150 hover:-translate-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{item.label}</span>
                <span className={cn("rounded-2xl p-2", item.tone)}><item.icon className="size-4" /></span>
              </div>
              <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{item.value}</p>
            </Link>
          ))}
        </section>
      ) : null}

      {canMyKpis && myKpis?.kpi ? (
        <section className={card("p-6")}>
          {myKpis.section === "patient_manager" ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">My patient-manager KPI scorecard</h2>
                  <p className="mt-1 text-sm text-slate-500">Assigned patient load, open operational pressure and checklist quality in one view.</p>
                </div>
                <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">{myKpis.kpi.active_patients} patients</Badge>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                {metricCard("Active patients", myKpis.kpi.active_patients, Users)}
                {metricCard("Active orders", myKpis.kpi.active_orders, FileText)}
                {metricCard("Open tasks", myKpis.kpi.open_tasks, Bell)}
                {metricCard("Overdue tasks", myKpis.kpi.overdue_tasks, RefreshCw)}
                {metricCard("Checklist completion", formatPercent(myKpis.kpi.checklist_completion_rate_pct), TrendingUp)}
                {metricCard("Feedback", formatRating(myKpis.kpi.avg_feedback_score), ArrowRight)}
              </div>
            </>
          ) : null}

          {myKpis.section === "interpreter" ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">My interpreter KPI scorecard</h2>
                  <p className="mt-1 text-sm text-slate-500">Booked versus approved hours, current load and patient feedback for your own assignments.</p>
                </div>
                <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">{formatPercent(myKpis.kpi.utilization_rate_pct)}</Badge>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                {metricCard("Approved hours / 30d", formatCompactNumber(myKpis.kpi.approved_hours_30d, "h"), CalendarDays)}
                {metricCard("Booked hours / 30d", formatCompactNumber(myKpis.kpi.booked_hours_30d, "h"), CalendarDays)}
                {metricCard("Upcoming / 30d", formatCompactNumber(myKpis.kpi.upcoming_hours_30d, "h"), TrendingUp)}
                {metricCard("Completed appointments", myKpis.kpi.completed_appointments_30d, BriefcaseMedical)}
                {metricCard("Utilization", formatPercent(myKpis.kpi.utilization_rate_pct), RefreshCw)}
                {metricCard("Feedback", formatRating(myKpis.kpi.avg_feedback_score), ArrowRight)}
              </div>
            </>
          ) : null}

          {myKpis.section === "concierge" ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">My concierge KPI scorecard</h2>
                  <p className="mt-1 text-sm text-slate-500">Service execution load, billing handoff readiness and patient-portal demand for your queue.</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{myKpis.kpi.active_services} active</Badge>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                {metricCard("Active services", myKpis.kpi.active_services, BriefcaseMedical)}
                {metricCard("Completed / 30d", myKpis.kpi.completed_services_30d, CalendarDays)}
                {metricCard("Ready for billing", myKpis.kpi.ready_for_billing, FileText)}
                {metricCard("Portal requests / 30d", myKpis.kpi.portal_requests_30d, UserPlus)}
                {metricCard("Feedback", formatRating(myKpis.kpi.avg_feedback_score), ArrowRight)}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {executive && ceoDashboard ? (
        <>
          {executiveMetrics.length > 0 ? (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              {executiveMetrics.map((item) => (
                <div key={item.label} className={cn("rounded-[1.5rem] border p-4 shadow-sm", item.tone)}>
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{item.label}</p>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{item.value}</p>
                  <p className="mt-2 text-sm text-slate-600">{item.caption}</p>
                </div>
              ))}
            </section>
          ) : null}

          {executiveForecastMetrics.length > 0 ? (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {executiveForecastMetrics.map((item) => (
                <div key={item.label} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{item.label}</p>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{item.value}</p>
                  <p className="mt-2 text-sm text-slate-600">{item.caption}</p>
                </div>
              ))}
            </section>
          ) : null}

          <section className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
            <div className="space-y-6">
              <div className={card("p-6")}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">CEO read model</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Revenue, service mix and patient coverage aggregated from invoices, orders and active registry data.
                    </p>
                  </div>
                  <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{ceoDashboard.summary.active_patients_total} active profiles</Badge>
                </div>
                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Quarter volume</p>
                    <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                      {formatMoney(ceoDashboard.summary.invoiced_this_quarter)}
                    </p>
                    <p className="mt-2 text-sm text-slate-500">Materialized invoice gross in the current quarter.</p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Under care</p>
                    <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                      {ceoDashboard.summary.active_patients_under_care}
                    </p>
                    <p className="mt-2 text-sm text-slate-500">
                      Patients with at least one active order right now.
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                    <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Retention definition</p>
                    <p className="mt-3 text-sm font-semibold text-slate-950">
                      {ceoDashboard.summary.retention_definition}
                    </p>
                    <p className="mt-2 text-sm text-slate-500">
                      Used to avoid inventing a custom KPI formula outside the current data model.
                    </p>
                  </div>
                </div>
                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  {ceoDashboard.service_mix.length > 0 ? ceoDashboard.service_mix.map((item) => (
                    <div key={item.service_type} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-950">{serviceTypeLabel(item.service_type)}</p>
                        <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{item.item_count}</Badge>
                      </div>
                      <p className="mt-3 text-lg font-semibold tracking-tight text-slate-950">
                        {formatMoney(item.gross_total)}
                      </p>
                      <p className="mt-2 text-sm text-slate-500">Delivered, approved or invoiced service volume.</p>
                    </div>
                  )) : (
                    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500 md:col-span-3">
                      No service mix data available yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-3">
                <div className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">Patient manager KPIs</h2>
                      <p className="mt-1 text-sm text-slate-500">Assignments, open workload and checklist closure quality.</p>
                    </div>
                    <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">{ceoDashboard.patient_manager_kpis.length}</Badge>
                  </div>
                  <div className="mt-5 space-y-3">
                    {ceoDashboard.patient_manager_kpis.slice(0, 5).map((item) => (
                      <div key={item.user_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                          <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">{item.active_patients} patients</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {item.active_orders} active orders · {item.open_tasks} open tasks · {item.overdue_tasks} overdue
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          Checklist {formatPercent(item.checklist_completion_rate_pct)} · Feedback {formatRating(item.avg_feedback_score)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">Interpreter KPIs</h2>
                      <p className="mt-1 text-sm text-slate-500">Approved reporting hours, booked scope and feedback signal.</p>
                    </div>
                    <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">{ceoDashboard.interpreter_kpis.length}</Badge>
                  </div>
                  <div className="mt-5 space-y-3">
                    {ceoDashboard.interpreter_kpis.slice(0, 5).map((item) => (
                      <div key={item.user_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                          <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">{formatPercent(item.utilization_rate_pct)}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {formatCompactNumber(item.approved_hours_30d, "h")} approved · {formatCompactNumber(item.booked_hours_30d, "h")} booked
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          {formatCompactNumber(item.upcoming_hours_30d, "h")} upcoming · {item.completed_appointments_30d} completed · Feedback {formatRating(item.avg_feedback_score)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={card("p-6")}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-950">Concierge KPIs</h2>
                      <p className="mt-1 text-sm text-slate-500">Operational service load, billing handoff and patient-portal demand.</p>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{ceoDashboard.concierge_kpis.length}</Badge>
                  </div>
                  <div className="mt-5 space-y-3">
                    {ceoDashboard.concierge_kpis.slice(0, 5).map((item) => (
                      <div key={item.user_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{item.active_services} active</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">
                          {item.completed_services_30d} completed in 30d · {item.ready_for_billing} ready for billing
                        </p>
                        <p className="mt-2 text-xs text-slate-500">
                          {item.portal_requests_30d} portal requests in 30d · Feedback {formatRating(item.avg_feedback_score)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className={card("p-6")}>
                <h2 className="text-base font-semibold text-slate-950">Patient geography</h2>
                <p className="mt-1 text-sm text-slate-500">Active registry distribution by residence or fallback country fields.</p>
                <div className="mt-5 space-y-3">
                  {ceoDashboard.countries.length > 0 ? ceoDashboard.countries.map((item) => (
                    <div key={item.country} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-950">{item.country}</p>
                        <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{item.patient_count}</Badge>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                      No country distribution available yet.
                    </div>
                  )}
                </div>
              </div>

              <div className={card("p-6")}>
                <h2 className="text-base font-semibold text-slate-950">Patient sentiment</h2>
                <p className="mt-1 text-sm text-slate-500">Live NPS and promoter ranking from the feedback workspace.</p>
                {feedbackSummary ? (
                  <>
                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Overall score</p>
                        <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                          {formatRating(feedbackSummary.average_scores.overall)}
                        </p>
                        <p className="mt-2 text-sm text-slate-500">{feedbackSummary.total_feedback} feedback forms</p>
                      </div>
                      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.12em] text-slate-500">Concierge score</p>
                        <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                          {formatRating(feedbackSummary.average_scores.concierge)}
                        </p>
                        <p className="mt-2 text-sm text-slate-500">
                          {feedbackSummary.promoters} promoters · {feedbackSummary.detractors} detractors
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 space-y-3">
                      <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Top promoters</p>
                      {feedbackSummary.top_promoters.slice(0, 5).map((item) => (
                        <div key={item.patient_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-950">{item.patient_name}</p>
                            <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">{item.average_nps.toFixed(1)}</Badge>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            {item.feedback_count} feedback forms · {item.last_submitted_at ? fmtDate(item.last_submitted_at, true) : "No timestamp"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="mt-5 rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                    Feedback summary is not available yet.
                  </div>
                )}
              </div>

              <div className={card("p-6")}>
                <h2 className="text-base font-semibold text-slate-950">Clinic volume</h2>
                <p className="mt-1 text-sm text-slate-500">Medical providers ranked by delivered service volume and visit activity.</p>
                <div className="mt-5 space-y-3">
                  {ceoDashboard.provider_kpis.length > 0 ? ceoDashboard.provider_kpis.map((item) => (
                    <div key={item.provider_id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-950">{item.name}</p>
                        <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{formatMoney(item.gross_service_volume)}</Badge>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        {item.appointments_90d} appointments / 90d · {item.active_patients_90d} patients
                      </p>
                      <p className="mt-2 text-xs text-slate-500">Feedback {formatRating(item.avg_feedback_score)}</p>
                    </div>
                  )) : (
                    <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                      No provider KPI data available yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </>
      ) : null}

      {patientManagerRisk || billingRisk ? (
        <section
          className={cn(
            "grid gap-6",
            patientManagerRisk && billingRisk ? "xl:grid-cols-2" : "xl:grid-cols-1",
          )}
        >
          {patientManagerRisk ? (
            <div className={card("p-6")}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">Patient manager risk analysis</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Automatic signal layer over complex cases, overdue appointments, overdue tasks and workflow blockers.
                  </p>
                </div>
                <Badge className="bg-sky-100 text-sky-700 hover:bg-sky-100">
                  {patientManagerRisk.summary.total_alerts} alerts
                </Badge>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-rose-700">Urgent</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-rose-950">{patientManagerRisk.summary.urgent_alerts}</p>
                  <p className="mt-2 text-sm text-rose-700">{patientManagerRisk.summary.overdue_appointments} overdue appointments</p>
                </div>
                <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-amber-700">High</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-amber-950">{patientManagerRisk.summary.high_alerts}</p>
                  <p className="mt-2 text-sm text-amber-700">{patientManagerRisk.summary.complex_case_alerts} complex-case alerts</p>
                </div>
                <div className="rounded-[1.5rem] border border-sky-200 bg-sky-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-sky-700">Tasks</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-sky-950">{patientManagerRisk.summary.overdue_tasks}</p>
                  <p className="mt-2 text-sm text-sky-700">Overdue PM tasks</p>
                </div>
                <div className="rounded-[1.5rem] border border-violet-200 bg-violet-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-violet-700">Checklists</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-violet-950">{patientManagerRisk.summary.overdue_checklists}</p>
                  <p className="mt-2 text-sm text-violet-700">Overdue workflow items</p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {patientManagerRisk.alerts.length > 0 ? patientManagerRisk.alerts.slice(0, 6).map((alert) => (
                  <button
                    key={`${alert.patient_id}-${alert.severity}`}
                    type="button"
                    onClick={() => navigate(`/patients/${alert.patient_id}?tab=workflow`)}
                    className="w-full rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50/40"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-950">{alert.patient_label}</span>
                          <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", riskTone(alert.severity))}>
                            {alert.severity}
                          </span>
                          {alert.high_risk_label ? <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100">high_risk</Badge> : null}
                          {alert.fall_risk_label ? <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">fall_risk</Badge> : null}
                        </div>
                        <p className="mt-2 text-sm text-slate-600">{alert.title}</p>
                        <p className="mt-3 text-xs text-slate-500">
                          {alert.open_case_count} open cases · {alert.open_appointment_count} open appointments · {alert.open_task_count} open tasks
                        </p>
                        <ul className="mt-3 space-y-1 text-sm text-slate-600">
                          {alert.reasons.slice(0, 3).map((reason) => (
                            <li key={reason}>- {reason}</li>
                          ))}
                        </ul>
                      </div>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-slate-400" />
                    </div>
                  </button>
                )) : (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                    No current patient-manager risk signals.
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {billingRisk ? (
            <div className={card("p-6")}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">Billing risk analysis</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Automatic financial exposure layer over overdue invoices, blocked releases, package uncertainty and delivered scope not yet invoiced.
                  </p>
                </div>
                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                  {billingRisk.summary.total_alerts} alerts
                </Badge>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-rose-700">Urgent</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-rose-950">{billingRisk.summary.urgent_alerts}</p>
                  <p className="mt-2 text-sm text-rose-700">{billingRisk.summary.overdue_invoice_count} overdue invoices</p>
                </div>
                <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-amber-700">Blocked orders</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-amber-950">{billingRisk.summary.blocked_orders}</p>
                  <p className="mt-2 text-sm text-amber-700">Billing release or package gate unresolved</p>
                </div>
                <div className="rounded-[1.5rem] border border-sky-200 bg-sky-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-sky-700">Outstanding</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-sky-950">{formatMoney(billingRisk.summary.outstanding_balance_total)}</p>
                  <p className="mt-2 text-sm text-sky-700">Open receivables in risk set</p>
                </div>
                <div className="rounded-[1.5rem] border border-violet-200 bg-violet-50 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.12em] text-violet-700">Exposure gap</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-violet-950">{formatMoney(billingRisk.summary.exposure_gap_total)}</p>
                  <p className="mt-2 text-sm text-violet-700">Delivered scope above invoiced total</p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {billingRisk.alerts.length > 0 ? billingRisk.alerts.slice(0, 6).map((alert) => (
                  <button
                    key={`${alert.order_id}-${alert.severity}`}
                    type="button"
                    onClick={() => navigate(`/orders?order=${alert.order_id}`)}
                    className="w-full rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-amber-200 hover:bg-amber-50/30"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-950">{alert.order_number}</span>
                          <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", riskTone(alert.severity))}>
                            {alert.severity}
                          </span>
                          <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{alert.phase}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-slate-600">{alert.patient_label}</p>
                        <p className="mt-3 text-xs text-slate-500">
                          Outstanding {formatMoney(alert.outstanding_balance)} · Service {formatMoney(alert.service_gross)} · Invoiced {formatMoney(alert.invoiced_total)}
                        </p>
                        <ul className="mt-3 space-y-1 text-sm text-slate-600">
                          {alert.reasons.slice(0, 3).map((reason) => (
                            <li key={reason}>- {reason}</li>
                          ))}
                        </ul>
                      </div>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-slate-400" />
                    </div>
                  </button>
                )) : (
                  <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">
                    No current billing risk signals.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <div className={card("p-6")}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-950">My work queue</h2>
                <p className="mt-1 text-sm text-slate-500">Personal tasks from the live backend assignment layer.</p>
              </div>
              <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">{activeTasks.length} open</Badge>
            </div>
            <div className="mt-5 space-y-3">
              {activeTasks.length > 0 ? activeTasks.slice(0, 6).map((task) => (
                <div key={task.id} className="rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-950">{task.title}</span>
                        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", task.priority === "urgent" ? "border-rose-200 bg-rose-50 text-rose-700" : task.priority === "high" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-sky-200 bg-sky-50 text-sky-700")}>{task.priority}</span>
                        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", task.status === "in_progress" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-amber-200 bg-amber-50 text-amber-700")}>{task.status.replaceAll("_", " ")}</span>
                      </div>
                      {task.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{task.description}</p> : null}
                      <p className="mt-3 text-xs text-slate-500">{dueLabel(task.due_date)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {taskHref(task) ? <Button variant="outline" size="sm" onClick={() => navigate(taskHref(task) ?? "/")}>Open</Button> : null}
                      {task.status === "open" ? <Button size="sm" disabled={busyTaskId === task.id} onClick={() => void updateTask(task.id, "in_progress")}>{busyTaskId === task.id ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}Start</Button> : null}
                      {task.status !== "completed" && task.status !== "cancelled" ? <Button variant="outline" size="sm" disabled={busyTaskId === task.id} onClick={() => void updateTask(task.id, "completed")}>{busyTaskId === task.id ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}Complete</Button> : null}
                    </div>
                  </div>
                </div>
              )) : <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">No active tasks right now.</div>}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className={card("p-6")}>
              <h2 className="text-base font-semibold text-slate-950">Lead momentum</h2>
              <p className="mt-1 text-sm text-slate-500">Monthly intake trend and current qualification pace.</p>
              {leadsStats ? (
                <>
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{t.leads_total_month}</p>
                      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{leadsStats.total_this_month}</p>
                    </div>
                    <div className="rounded-[1.5rem] border border-violet-200 bg-violet-50 px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.12em] text-violet-700">Growth / conversions</p>
                      <p className="mt-3 flex items-center gap-2 text-3xl font-semibold tracking-tight text-violet-950"><TrendingUp className="size-5" />{leadsStats.growth_pct >= 0 ? "+" : ""}{leadsStats.growth_pct}%</p>
                      <p className="mt-2 text-sm text-violet-700">{leadsStats.qualified_this_month}/{leadsStats.converted_this_month} qualified/converted</p>
                    </div>
                  </div>
                  <div className="mt-5 flex h-40 items-end gap-2">
                    {bars.map((item) => <div key={item.label} className="flex flex-1 flex-col items-center gap-2"><div className="flex h-32 w-full items-end"><div className="w-full rounded-t-[1rem] bg-gradient-to-t from-sky-500 to-violet-500" style={{ height: `${Math.max((item.count / maxBar) * 100, item.count > 0 ? 8 : 0)}%` }} /></div><span className="text-[11px] uppercase tracking-[0.12em] text-slate-500">{item.label}</span></div>)}
                  </div>
                  <p className="mt-4 text-sm text-slate-500">Open pipeline volume: {leadsStats.total_all}</p>
                </>
              ) : <div className="mt-5 rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">Lead analytics are not available for this role.</div>}
            </div>

            <div className={card("p-6")}>
              <h2 className="text-base font-semibold text-slate-950">Order phase spread</h2>
              <p className="mt-1 text-sm text-slate-500">Distribution of active orders across execution phases.</p>
              {orderPhases.length > 0 ? (
                <div className="mt-5 space-y-4">
                  {orderPhases.map((item) => <div key={item.phase}><div className="flex items-center justify-between text-sm"><span className="font-medium text-slate-800">{item.phase}</span><span className="text-slate-500">{item.count}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-500" style={{ width: `${Math.max((item.count / Math.max(orderPhases[0]?.count ?? 1, 1)) * 100, 8)}%` }} /></div></div>)}
                </div>
              ) : <div className="mt-5 rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">Order analytics are not available for this role.</div>}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className={card("p-6")}>
            <h2 className="text-base font-semibold text-slate-950">Upcoming appointments</h2>
            <p className="mt-1 text-sm text-slate-500">Nearest slots from the live appointment board.</p>
            <div className="mt-5 space-y-3">
              {upcoming.length > 0 ? upcoming.slice(0, 6).map((item) => (
                <button key={item.id} type="button" onClick={() => navigate(`/appointments?appointment=${item.id}`)} className="w-full rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-950">{item.patient_name}</span>
                        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]", item.status === "confirmed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-blue-200 bg-blue-50 text-blue-700")}>{item.status}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">{item.title}</p>
                      <p className="mt-3 text-xs text-slate-500">{fmtDate(item.date)} · {(item.time_start ?? "").slice(0, 5) || "No time"} · {item.location || "No location"}</p>
                    </div>
                    <ArrowRight className="mt-1 size-4 shrink-0 text-slate-400" />
                  </div>
                </button>
              )) : <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">No upcoming appointments available.</div>}
            </div>
          </div>

          <div className={card("p-6")}>
            <h2 className="text-base font-semibold text-slate-950">Latest notifications</h2>
            <p className="mt-1 text-sm text-slate-500">Unread workflow signals routed from backend events.</p>
            <div className="mt-5 space-y-3">
              {unread.length > 0 ? unread.map((item) => (
                <button key={item.id} type="button" onClick={() => navigate(notificationHref(item) ?? "/")} className="w-full rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-violet-200 hover:bg-violet-50/40">
                  <div className="flex items-start gap-3">
                    <span className="rounded-2xl border border-violet-200 bg-violet-50 p-2 text-violet-700"><Bell className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-slate-950">{item.title}</p><Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100">New</Badge></div>
                      {item.body ? <p className="mt-1 text-sm text-slate-600">{item.body}</p> : null}
                      <p className="mt-3 text-xs text-slate-500">{fmtDate(item.created_at, true)}</p>
                    </div>
                  </div>
                </button>
              )) : <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-sm text-slate-500">No unread notifications right now.</div>}
            </div>
          </div>

          <div className={card("p-6")}>
            <h2 className="text-base font-semibold text-slate-950">Quick links</h2>
            <p className="mt-1 text-sm text-slate-500">Jump directly into the highest-value workspaces.</p>
            <div className="mt-5 grid gap-3">
              <Link to="/patients" className="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm transition-colors hover:border-sky-200 hover:bg-sky-50/40"><div className="flex items-center gap-3"><span className="rounded-2xl bg-sky-100 p-2 text-sky-700"><Users className="size-4" /></span><div><p className="text-sm font-semibold text-slate-950">Patient registry</p><p className="text-sm text-slate-500">Profiles, assignments and care context</p></div></div><ArrowRight className="size-4 text-slate-400" /></Link>
              <Link to="/providers" className="flex items-center justify-between rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50/40"><div className="flex items-center gap-3"><span className="rounded-2xl bg-emerald-100 p-2 text-emerald-700"><Building2 className="size-4" /></span><div><p className="text-sm font-semibold text-slate-950">Clinic network</p><p className="text-sm text-slate-500">Providers, doctors, services and linked patients</p></div></div><ArrowRight className="size-4 text-slate-400" /></Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
