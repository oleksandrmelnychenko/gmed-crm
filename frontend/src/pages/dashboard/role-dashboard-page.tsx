import { useCallback, useEffect, useMemo, useState, type ElementType } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Gauge,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { listStaffNavItems } from "@/lib/staff-route-access";
import { localizeTimelineTitle } from "@/lib/timeline-labels";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import {
  TASK_MANAGER_ROLES,
  conciergeTaskCode,
  conciergeTaskScheduledAt,
  isConciergeTaskActive,
  isConciergeTaskOverdue,
  type ConciergeTask,
} from "@/pages/concierge/model";

import {
  isConciergeTaskDueToday,
  roleDashboardFocusTasks,
} from "./model/role-dashboard-focus";
import { greetingFor } from "./model/staff-dashboard-formatters";
import {
  roleDashboardDefinition,
  type RoleDashboardMetric,
} from "./model/role-dashboard-config";
import { OpenTaskQueueLink } from "./ui/open-task-queue-link";

type RoleKpiResponse = {
  section: string;
  kpi: Record<string, unknown> | null;
};

const KPI_ICONS: ElementType[] = [Users, ClipboardCheck, Clock3, TrendingUp];

const ROLE_DASHBOARD_EVENTS = [
  "concierge_operational_item.created",
  "concierge_operational_item.updated",
  "concierge_operational_item.deleted",
  "patient.created",
  "patient.updated",
  "patient.assigned",
  "lead.created",
  "lead.updated",
  "lead.status_changed",
  "lead.converted",
  "appointment.created",
  "appointment.updated",
  "appointment.status_changed",
  "order.created",
  "order.phase_changed",
  "invoice.created",
  "invoice.status_changed",
  "concierge_service.created",
  "concierge_service.updated",
  "concierge_service.billing_ready",
] as const;

const METRIC_ROUTES: Record<string, string> = {
  active_patients: "/patients",
  active_orders: "/orders",
  appointments_next_7d: "/appointments",
  completed_appointments_30d: "/appointments",
  upcoming_hours_30d: "/appointments",
  open_tasks: "/task-manager",
  overdue_tasks: "/task-manager?timing=overdue",
  open_checklist_items: "/task-manager",
  active_services: "/concierge",
  completed_services_30d: "/concierge",
  ready_for_billing: "/concierge",
  portal_requests_30d: "/concierge",
  new_leads_30d: "/leads",
  qualified_leads_30d: "/leads",
  converted_leads_30d: "/leads",
  lead_to_patient_conversion_rate_pct: "/leads",
  outstanding_receivables_total: "/company-finance",
  overdue_invoice_count: "/company-finance",
  invoices_30d: "/company-finance",
};

function numberValue(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatMetric(metric: RoleDashboardMetric, value: unknown, lang: Lang): string {
  const numeric = numberValue(value);
  if (numeric === null) return "—";

  switch (metric.format) {
    case "currency":
      return new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(numeric);
    case "percent":
      return `${new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
        maximumFractionDigits: 1,
      }).format(numeric)}%`;
    case "hours":
      return `${new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
        maximumFractionDigits: 1,
      }).format(numeric)} ${lang === "de" ? "Std." : "ч"}`;
    case "days":
      return `${new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
        maximumFractionDigits: 1,
      }).format(numeric)} ${lang === "de" ? "Tage" : "дн."}`;
    case "score":
      return `${new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
        maximumFractionDigits: 1,
      }).format(numeric)} / 5`;
    default:
      return new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
        maximumFractionDigits: 1,
      }).format(numeric);
  }
}

function MetricCard({
  icon: Icon,
  metric,
  value,
  lang,
  loading,
  onClick,
}: {
  icon: ElementType;
  metric: RoleDashboardMetric;
  value: unknown;
  lang: Lang;
  loading: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="absolute left-0 top-4 h-8 w-0.5 rounded-r-full bg-[var(--brand)]" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] text-muted-foreground">{metric.label}</p>
          {loading ? (
            <div className="mt-3 h-7 w-24 animate-pulse rounded bg-muted" />
          ) : (
            <p className="mt-2 truncate text-[24px] font-semibold leading-none tracking-tight text-foreground">
              {formatMetric(metric, value, lang)}
            </p>
          )}
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{metric.hint}</p>
        </div>
        <div className="flex items-center gap-2">
          <Icon className="size-[18px] shrink-0 text-muted-foreground" />
          {onClick ? <ArrowUpRight className="size-3.5 text-muted-foreground/70" /> : null}
        </div>
      </div>
    </>
  );

  const className = cn(
    "relative min-h-32 w-full overflow-hidden rounded-lg border border-border/70 bg-card p-4 text-left",
    onClick && "transition-colors hover:border-foreground/25 hover:bg-muted/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  );

  return onClick ? (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  ) : (
    <article className={className}>{content}</article>
  );
}

export function RoleDashboardPage({ role, preview = false }: { role: string; preview?: boolean }) {
  const { user } = useAuth();
  const { lang, t } = useLang();
  const { staffGo } = useStaffNavigate();
  const tr = t as unknown as Record<string, string>;
  const definition = useMemo(() => roleDashboardDefinition(role, lang), [lang, role]);
  const [kpi, setKpi] = useState<Record<string, unknown> | null>(
    preview ? definition.preview : null,
  );
  const [loading, setLoading] = useState(!preview);
  const [failed, setFailed] = useState(false);
  const [tasks, setTasks] = useState<ConciergeTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(!preview);
  const canUseTaskManager = Boolean(
    user?.id && TASK_MANAGER_ROLES.includes(role as (typeof TASK_MANAGER_ROLES)[number]),
  );

  const refreshDashboard = useCallback(() => {
    if (preview) {
      setKpi(definition.preview);
      setLoading(false);
      setFailed(false);
      setTasks([]);
      setTasksLoading(false);
      return () => undefined;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);
    if (canUseTaskManager) setTasksLoading(true);

    const kpiRequest = apiFetch<RoleKpiResponse>("/stats/my-kpis", { forceFresh: true })
      .then((response) => {
        if (!cancelled) setKpi(response.kpi ?? {});
      })
      .catch(() => {
        if (!cancelled) {
          setKpi({});
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const taskRequest = user?.id && canUseTaskManager
      ? apiFetch<ConciergeTask[]>(
          `/concierge-operational-items?assigned_to=${encodeURIComponent(user.id)}`,
          { forceFresh: true },
        )
          .then((items) => {
            if (!cancelled) setTasks(items);
          })
          .catch(() => {
            if (!cancelled) setTasks([]);
          })
          .finally(() => {
            if (!cancelled) setTasksLoading(false);
          })
      : Promise.resolve().then(() => {
          if (!cancelled) {
            setTasks([]);
            setTasksLoading(false);
          }
        });

    void Promise.all([kpiRequest, taskRequest]);

    return () => {
      cancelled = true;
    };
  }, [canUseTaskManager, definition, preview, user?.id]);

  useEffect(() => refreshDashboard(), [refreshDashboard]);
  useDebouncedRealtimeSubscription(ROLE_DASHBOARD_EVENTS, refreshDashboard, 300);

  const greeting = greetingFor(user?.name ?? "", tr);
  const roleTitle = tr[`role_${role}`] ?? role;
  const navItems = useMemo(() => listStaffNavItems(role), [role]);
  const quickLinks = navItems.filter((item) => item.to !== "/").slice(0, 4);
  const availableRoutes = useMemo(
    () => new Set(navItems.map((item) => item.to.split("?")[0])),
    [navItems],
  );
  const activeTasks = useMemo(
    () => tasks.filter((task) => !task.archived_at && isConciergeTaskActive(task)),
    [tasks],
  );
  const focusTasks = useMemo(
    () => roleDashboardFocusTasks(activeTasks, new Date(), 4),
    [activeTasks],
  );
  const showLiveFocus = canUseTaskManager && !preview;
  const secondaryMetrics = definition.metrics.slice(4);
  const copy = lang === "de"
    ? {
        priorities: "Fokus heute",
        prioritiesHint: "Die wichtigsten nächsten Schritte",
        details: "Weitere Kennzahlen",
        detailsHint: "Zusätzlicher Kontext für Ihre Arbeit",
        quick: "Schnellzugriff",
        quickHint: "Nur für Ihre Rolle freigegebene Bereiche",
        unavailable: "Aktuelle Kennzahlen konnten nicht geladen werden.",
        live: "Live priorisiert",
        allClear: "Keine dringenden Aufgaben in Ihrer persönlichen Queue.",
        overdue: "Überfällig",
        today: "Heute",
        noDue: "Ohne Frist",
        patient: "Patient",
        provider: "Anbieter",
      }
    : {
        priorities: "Фокус на сегодня",
        prioritiesHint: "Главные следующие действия",
        details: "Дополнительные показатели",
        detailsHint: "Контекст для вашей ежедневной работы",
        quick: "Быстрый доступ",
        quickHint: "Только разрешённые для вашей роли разделы",
        unavailable: "Актуальные показатели пока не удалось загрузить.",
        live: "Приоритеты в реальном времени",
        allClear: "В вашей очереди сейчас нет срочных задач.",
        overdue: "Просрочено",
        today: "Сегодня",
        noDue: "Без срока",
        patient: "Пациент",
        provider: "Провайдер",
      };

  const formatTaskDate = (task: ConciergeTask) => {
    const date = conciergeTaskScheduledAt(task);
    if (!date) return copy.noDue;
    return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-[var(--brand)]" />
            {definition.eyebrow}
          </div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">
            {greeting}
          </h1>
          {role !== "concierge" ? (
            <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted-foreground">
              {definition.subtitle}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OpenTaskQueueLink />
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 text-[12px] text-muted-foreground">
            <ShieldCheck className="size-4 text-[var(--brand)]" />
            {roleTitle}
          </div>
        </div>
      </header>

      {failed ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          {copy.unavailable}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {definition.metrics.slice(0, 4).map((metricItem, index) => {
          const route = METRIC_ROUTES[metricItem.key];
          const canOpenRoute = route && availableRoutes.has(route.split("?")[0]);
          return (
            <MetricCard
              key={metricItem.key}
              icon={KPI_ICONS[index] ?? Gauge}
              lang={lang}
              loading={loading}
              metric={metricItem}
              value={kpi?.[metricItem.key]}
              onClick={canOpenRoute ? () => staffGo(route) : undefined}
            />
          );
        })}
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <article className="overflow-hidden rounded-lg border border-border/70 bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" />
              <h2 className="text-[14px] font-semibold text-foreground">{copy.details}</h2>
            </div>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{copy.detailsHint}</p>
          </div>
          <div className="grid md:grid-cols-2">
            {(secondaryMetrics.length > 0 ? secondaryMetrics : definition.metrics.slice(0, 2)).map(
              (metricItem, index) => {
                const icons = [CircleDollarSign, CircleDollarSign, Gauge, Sparkles];
                const Icon = icons[index] ?? Sparkles;
                return (
                  <div
                    key={metricItem.key}
                    className={cn(
                      "flex items-center gap-3 px-4 py-4",
                      index > 0 && "border-t border-border",
                      index === 1 && "md:border-l md:border-t-0",
                      index > 1 && index % 2 === 1 && "md:border-l",
                    )}
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30">
                      <Icon className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] text-muted-foreground">{metricItem.label}</p>
                      <p className="mt-0.5 truncate text-[17px] font-semibold text-foreground">
                        {loading ? "—" : formatMetric(metricItem, kpi?.[metricItem.key], lang)}
                      </p>
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </article>

        <article className="overflow-hidden rounded-lg border border-border/70 bg-card">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <CalendarClock className="size-4 text-muted-foreground" />
                <h2 className="text-[14px] font-semibold text-foreground">{copy.priorities}</h2>
              </div>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">{copy.prioritiesHint}</p>
            </div>
            {showLiveFocus ? (
              <button
                type="button"
                onClick={() => staffGo("/task-manager")}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/60 px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {copy.live}
                <ArrowRight className="size-3" />
              </button>
            ) : null}
          </div>
          <div className="divide-y divide-border">
            {tasksLoading && showLiveFocus ? (
              Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="space-y-2 px-4 py-3.5">
                  <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-full animate-pulse rounded bg-muted" />
                </div>
              ))
            ) : showLiveFocus && focusTasks.length > 0 ? (
              focusTasks.map((task) => {
                const now = new Date();
                const overdue = isConciergeTaskOverdue(task, now);
                const dueToday = !overdue && isConciergeTaskDueToday(task, now);
                const context = task.patient_name
                  ? `${copy.patient}: ${task.patient_name}`
                  : task.provider_name
                    ? `${copy.provider}: ${task.provider_name}`
                    : task.location;
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => staffGo(`/task-manager?task=${encodeURIComponent(task.id)}`)}
                    className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        overdue
                          ? "bg-rose-500"
                          : dueToday
                            ? "bg-amber-500"
                            : task.priority === "urgent" || task.priority === "high"
                              ? "bg-orange-500"
                              : "bg-sky-500",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="font-mono tracking-wide">{conciergeTaskCode(task)}</span>
                        <span aria-hidden="true">·</span>
                        <span className={cn(overdue && "font-medium text-rose-600") }>
                          {overdue ? copy.overdue : dueToday ? copy.today : formatTaskDate(task)}
                        </span>
                      </span>
                      <span className="mt-1 block break-words text-[12.5px] font-medium leading-5 text-foreground">
                        {localizeTimelineTitle(task.title, (key) => tr[key] ?? key)}
                      </span>
                      {context ? (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {context}
                        </span>
                      ) : null}
                    </span>
                    <ArrowUpRight className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                  </button>
                );
              })
            ) : showLiveFocus ? (
              <div className="flex items-center gap-3 px-4 py-5">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                <p className="text-[12.5px] leading-5 text-muted-foreground">{copy.allClear}</p>
              </div>
            ) : (
              definition.focus.map((item, index) => (
                <div key={item} className="flex items-start gap-3 px-4 py-3">
                  <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground">
                    {index + 1}
                  </div>
                  <p className="text-[12.5px] leading-5 text-foreground">{item}</p>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      {quickLinks.length > 0 ? (
        <section>
          <div className="mb-2 px-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.quick}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-foreground">{copy.quickHint}</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {quickLinks.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => staffGo(item.to)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-left",
                  "transition-colors hover:border-foreground/30",
                )}
              >
                <CheckCircle2 className="size-4 text-[var(--brand)]" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                  {tr[item.labelKey] ?? item.id}
                </span>
                <ArrowRight className="size-3.5 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
