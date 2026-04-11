import { startTransition, useEffect, useMemo, useState } from "react";
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
import { cn } from "@/lib/utils";

type OverviewStats = { patients: number; leads: number; orders: number; appointments: number; cases: number; users: number };
type LeadsStats = { total_this_month: number; growth_pct: number; qualified_this_month: number; converted_this_month: number; total_all: number };
type MonthlyEntry = { month: string; count: number };
type OrderPhaseEntry = { phase: string; count: number };
type UpcomingAppointment = { id: string; title: string; date: string; time_start?: string | null; type?: string | null; status: string; location?: string | null; patient_name: string };
type TaskItem = { id: string; title: string; description?: string | null; patient_id?: string | null; order_id?: string | null; appointment_id?: string | null; due_date?: string | null; priority: string; status: string };
type NotificationItem = { id: string; title: string; body?: string | null; entity_type?: string | null; entity_id?: string | null; is_read: boolean; created_at: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function card(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]",
    extra
  );
}

function roleLabel(role: string, tr: Record<string, string>) {
  return tr[`role_${role}`] ?? role.replaceAll("_", " ");
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
  if (item.patient_id) return `/patients?patient=${item.patient_id}`;
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
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const canOverview = executive || role === "patient_manager" || role === "billing" || role === "sales";
  const canLeads = executive || role === "patient_manager" || role === "sales";
  const canOrders = executive || role === "patient_manager" || role === "billing";
  const canUpcoming = executive || role === "patient_manager" || role === "teamlead_interpreter";
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
      const [ov, ls, mo, op, up, ta, no] = await Promise.all([
        canOverview ? apiFetch<OverviewStats>("/stats/overview").catch(() => null) : Promise.resolve(null),
        canLeads ? apiFetch<LeadsStats>("/stats/leads").catch(() => null) : Promise.resolve(null),
        canLeads ? apiFetch<MonthlyEntry[]>("/stats/leads/monthly").catch(() => []) : Promise.resolve([]),
        canOrders ? apiFetch<OrderPhaseEntry[]>("/stats/orders/by-phase").catch(() => []) : Promise.resolve([]),
        canUpcoming ? apiFetch<UpcomingAppointment[]>("/stats/appointments/upcoming").catch(() => []) : Promise.resolve([]),
        canTasks ? apiFetch<TaskItem[]>("/tasks?mine_only=true").catch(() => []) : Promise.resolve([]),
        apiFetch<NotificationItem[]>("/notifications").catch(() => []),
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
      });
      setLoading(false);
      setRefreshing(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [canLeads, canOrders, canOverview, canTasks, canUpcoming, loading, user, version]);

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
