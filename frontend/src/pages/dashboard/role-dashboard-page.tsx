import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlarmClock,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Calculator,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  ClockCheck,
  ConciergeBell,
  ContactRound,
  Database,
  FileClock,
  Fingerprint,
  Gauge,
  Globe2,
  HandCoins,
  History,
  Hospital,
  Inbox,
  Layers3,
  LayoutGrid,
  ListChecks,
  ListTodo,
  LockKeyhole,
  Monitor,
  PackageCheck,
  ReceiptText,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
  Star,
  Timer,
  TrendingUp,
  UserRoundCheck,
  UserRoundPlus,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { apiFetch } from "@/lib/api";
import { SectionHeading } from "@/components/ui/section-heading";
import { PortalDateChip } from "@/components/ui/portal-date-chip";
import { navItemIcon } from "@/components/nav-item-icon";
import { formatAppDate } from "@/lib/app-time-zone";
import { formatMoneyAmount } from "@/lib/money";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { primaryModulesFor } from "@/lib/role-cabinets";
import { listStaffNavItems } from "@/lib/staff-route-access";
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
  dashboardBookingsPath,
  roleDashboardBookingItems,
  roleHasDashboardBookings,
  type DashboardAppointmentRow,
} from "./model/role-dashboard-bookings";
import {
  dashboardTaskTitle,
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

const KPI_ICONS: Record<string, LucideIcon> = {
  active_lead_country_count: Globe2,
  active_orders: ClipboardList,
  active_patients: UsersRound,
  active_services: ConciergeBell,
  active_sessions: Monitor,
  active_users: UsersRound,
  appointments_next_7d: CalendarDays,
  approved_hours_30d: ClockCheck,
  audit_events_24h: History,
  avg_feedback_score: Star,
  avg_invoice_gross: Calculator,
  avg_service_to_invoice_days: Timer,
  blocked_logins_24h: ShieldBan,
  booked_hours_30d: Timer,
  checklist_completion_rate_pct: ClipboardCheck,
  completed_appointments_30d: CalendarCheck,
  completed_services_30d: PackageCheck,
  converted_leads_30d: ContactRound,
  db_active_connections: Database,
  failed_logins_24h: ShieldAlert,
  hours_approval_rate_pct: BadgeCheck,
  invoices_30d: ReceiptText,
  lead_to_patient_conversion_rate_pct: TrendingUp,
  locked_accounts: LockKeyhole,
  new_leads_30d: UserRoundPlus,
  new_partner_clinics_90d: Hospital,
  open_advance_requests_total: HandCoins,
  open_checklist_items: ListChecks,
  open_tasks: ListTodo,
  outstanding_receivables_total: Wallet,
  overdue_invoice_count: FileClock,
  overdue_tasks: AlarmClock,
  paid_within_14d_rate_pct: CalendarCheck,
  pending_logins: Fingerprint,
  pending_reports: FileClock,
  portal_requests_30d: Inbox,
  qualified_leads: UserRoundCheck,
  qualified_leads_30d: UserRoundCheck,
  ready_for_billing: ReceiptText,
  taxonomy_mix: Layers3,
  team_size: UsersRound,
  upcoming_hours_30d: CalendarClock,
};

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
  // An interpreter's booking or answer reaches the others as a notification.
  "notification.created",
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
  open_advance_requests_total: "/invoices",
  overdue_invoice_count: "/company-finance",
  invoices_30d: "/company-finance",
  active_sessions: "/admin/security",
  locked_accounts: "/admin/users",
  pending_logins: "/admin/security",
  failed_logins_24h: "/admin/activity",
  blocked_logins_24h: "/admin/activity",
  active_users: "/admin/users",
  db_active_connections: "/admin/health",
  audit_events_24h: "/admin/activity",
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

// German number style in every language, like the finance pages ("1.234,5");
// money as "10.595,40 €" (lib/money).
const METRIC_NUMBER = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

function formatMetric(metric: RoleDashboardMetric, value: unknown, lang: Lang): string {
  const numeric = numberValue(value);
  if (numeric === null) return "—";

  switch (metric.format) {
    case "currency":
      return formatMoneyAmount(numeric, "EUR");
    case "percent":
      return `${METRIC_NUMBER.format(numeric)} %`;
    case "hours":
      return `${METRIC_NUMBER.format(numeric)} ${lang === "de" ? "Std." : "ч"}`;
    case "days":
      // A duration is never negative.
      return `${METRIC_NUMBER.format(Math.max(numeric, 0))} ${lang === "de" ? "Tage" : "дн."}`;
    case "score":
      return `${METRIC_NUMBER.format(numeric)} / 5`;
    default:
      return METRIC_NUMBER.format(numeric);
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
  icon: LucideIcon;
  metric: RoleDashboardMetric;
  value: unknown;
  lang: Lang;
  loading: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionHeading icon={Icon}>{metric.label}</SectionHeading>
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
          {onClick ? <ArrowUpRight className="size-3.5 text-muted-foreground/70" /> : null}
        </div>
      </div>
    </>
  );

  const className = cn(
    "staff-overview-card min-w-0 w-full p-4 text-left",
    onClick && "transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
  const hasScorecard = definition.metrics.length > 0;
  const [kpi, setKpi] = useState<Record<string, unknown> | null>(
    preview ? definition.preview : null,
  );
  const [loading, setLoading] = useState(!preview && hasScorecard);
  const [failed, setFailed] = useState(false);
  const [tasks, setTasks] = useState<ConciergeTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(!preview);
  // Bookings that wait for the interpreter's answer or for another
  // interpreter (QA 2026-11-10, D-16; owner decision on D-14).
  const [bookingRows, setBookingRows] = useState<DashboardAppointmentRow[]>([]);
  const canUseTaskManager = Boolean(
    user?.id && TASK_MANAGER_ROLES.includes(role as (typeof TASK_MANAGER_ROLES)[number]),
  );
  const loadsBookings = Boolean(user?.id && user.role === role && roleHasDashboardBookings(role));

  const refreshDashboard = useCallback(() => {
    if (preview) {
      setKpi(definition.preview);
      setLoading(false);
      setFailed(false);
      setTasks([]);
      setTasksLoading(false);
      setBookingRows([]);
      return () => undefined;
    }

    let cancelled = false;
    setLoading(hasScorecard);
    setFailed(false);
    if (canUseTaskManager) setTasksLoading(true);

    // A neutral cabinet (role without a preset) has no scorecard to fetch.
    const kpiRequest = hasScorecard
      ? apiFetch<RoleKpiResponse>("/stats/my-kpis", { forceFresh: true })
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
          })
      : Promise.resolve();

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

    const bookingRequest = loadsBookings
      ? apiFetch<DashboardAppointmentRow[]>(dashboardBookingsPath(), { forceFresh: true })
          .then((rows) => {
            if (!cancelled) setBookingRows(rows);
          })
          .catch(() => {
            if (!cancelled) setBookingRows([]);
          })
      : Promise.resolve().then(() => {
          if (!cancelled) setBookingRows([]);
        });

    void Promise.all([kpiRequest, taskRequest, bookingRequest]);

    return () => {
      cancelled = true;
    };
  }, [canUseTaskManager, definition, hasScorecard, loadsBookings, preview, user?.id]);

  useEffect(() => refreshDashboard(), [refreshDashboard]);
  useDebouncedRealtimeSubscription(ROLE_DASHBOARD_EVENTS, refreshDashboard, 300);

  const greeting = greetingFor(user?.name ?? "", tr);
  const roleTitle = tr[`role_${role}`] ?? role;
  const navCapabilities = user?.role === role ? (user.capabilities ?? null) : null;
  const navItems = useMemo(() => listStaffNavItems(role, navCapabilities), [navCapabilities, role]);
  // Primary cabinet modules the user's capabilities open; a role whose
  // capability set opens none of them gets no quick link.
  const quickLinks = useMemo(
    () => primaryModulesFor(role, navCapabilities),
    [navCapabilities, role],
  );
  const quickLinksUnavailable = definition.primaryModules.length > 0 && quickLinks.length === 0;
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
  const bookingItems = useMemo(
    () => roleDashboardBookingItems(bookingRows, user?.id, role, 4),
    [bookingRows, role, user?.id],
  );
  const showLiveFocus = (canUseTaskManager || loadsBookings) && !preview;
  const secondaryMetrics = definition.metrics.slice(4);
  const copy = lang === "de"
    ? {
        priorities: "Fokus heute",
        details: "Weitere Kennzahlen",
        quick: "Schnellzugriff",
        unavailable: "Aktuelle Kennzahlen konnten nicht geladen werden.",
        live: "Live priorisiert",
        allClear: "Keine dringenden Aufgaben in Ihrer persönlichen Queue.",
        overdue: "Überfällig",
        today: "Heute",
        noDue: "Ohne Frist",
        patient: "Patient",
        provider: "Anbieter",
        answerBooking: "Einsatz bestätigen oder ablehnen",
        replaceInterpreter: "Dolmetscher hat abgelehnt – anderen buchen",
        interpreter: "Dolmetscher",
      }
    : {
        priorities: "Фокус на сегодня",
        details: "Дополнительные показатели",
        quick: "Быстрый доступ",
        unavailable: "Актуальные показатели пока не удалось загрузить.",
        live: "Приоритеты в реальном времени",
        allClear: "В вашей очереди сейчас нет срочных задач.",
        overdue: "Просрочено",
        today: "Сегодня",
        noDue: "Без срока",
        patient: "Пациент",
        provider: "Провайдер",
        answerBooking: "Подтвердите или отклоните участие",
        replaceInterpreter: "Переводчик отказался — назначьте другого",
        interpreter: "Переводчик",
      };

  return (
    <div className="grid min-w-0 gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        {/* A long unbroken name wraps instead of widening the block past a phone screen (QA D-21). */}
        <div className="min-w-0 max-w-full">
          <h1
            className="text-[22px] font-semibold leading-tight tracking-tight text-foreground [overflow-wrap:anywhere]"
            data-testid="role-dashboard-greeting"
          >
            {greeting}
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted-foreground">
            {definition.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OpenTaskQueueLink />
          {preview && <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 text-[12px] text-muted-foreground">
            <ShieldCheck className="size-4 text-[var(--brand)]" />
            {roleTitle}
          </div>}
        </div>
      </header>

      {failed ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          {copy.unavailable}
        </div>
      ) : null}

      {hasScorecard ? (
      <section className="grid gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
        {definition.metrics.slice(0, 4).map((metricItem) => {
          const route = METRIC_ROUTES[metricItem.key];
          const canOpenRoute = route && availableRoutes.has(route.split("?")[0]);
          return (
            <MetricCard
              key={metricItem.key}
              icon={KPI_ICONS[metricItem.key] ?? Gauge}
              lang={lang}
              loading={loading}
              metric={metricItem}
              value={kpi?.[metricItem.key]}
              onClick={canOpenRoute ? () => staffGo(route) : undefined}
            />
          );
        })}
      </section>
      ) : null}

      {hasScorecard || showLiveFocus || definition.focus.length > 0 ? (
      <section
        className={cn(
          "grid gap-3",
          hasScorecard && "lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]",
        )}
      >
        {hasScorecard ? (
        <article className="staff-overview-card min-w-0 overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h2><SectionHeading icon={Activity}>{copy.details}</SectionHeading></h2>
          </div>
          <div className="grid md:grid-cols-2">
            {(secondaryMetrics.length > 0 ? secondaryMetrics : definition.metrics.slice(0, 2)).map(
              (metricItem, index) => {
                const Icon = KPI_ICONS[metricItem.key] ?? Gauge;
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
                    <div className="flex size-6 shrink-0 items-center justify-center text-foreground [&>svg]:size-[22px]">
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
        ) : null}

        <article className="staff-overview-card min-w-0 overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <h2><SectionHeading icon={CalendarClock}>{copy.priorities}</SectionHeading></h2>
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
            ) : showLiveFocus && (bookingItems.length > 0 || focusTasks.length > 0) ? (
              <>
              {bookingItems.map((item) => {
                const when = [formatAppDate(item.date) || item.date, item.timeStart]
                  .filter(Boolean)
                  .join(" ");
                const context = [
                  item.patientName ? `${copy.patient}: ${item.patientName}` : "",
                  item.kind === "replace_interpreter" && item.interpreterName
                    ? `${copy.interpreter}: ${item.interpreterName}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <button
                    key={`booking:${item.id}`}
                    type="button"
                    data-testid={`dashboard-booking-${item.kind}`}
                    onClick={() =>
                      staffGo(`/appointments?appointment=${encodeURIComponent(item.id)}`)
                    }
                    className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        item.kind === "replace_interpreter" ? "bg-rose-500" : "bg-amber-500",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span
                          className={cn(
                            "font-medium",
                            item.kind === "replace_interpreter" ? "text-rose-600" : "text-amber-700",
                          )}
                        >
                          {item.kind === "replace_interpreter"
                            ? copy.replaceInterpreter
                            : copy.answerBooking}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{when}</span>
                      </span>
                      <span className="mt-1 block break-words text-[12.5px] font-medium leading-5 text-foreground">
                        {item.title}
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
              })}
              {focusTasks.map((task) => {
                const now = new Date();
                const scheduledAt = conciergeTaskScheduledAt(task);
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
                        {overdue || dueToday ? <span className={cn(overdue && "font-medium text-rose-600")}>{overdue ? copy.overdue : copy.today}</span> : null}
                        {scheduledAt ? <PortalDateChip timestamp={scheduledAt.toISOString()} /> : copy.noDue}
                      </span>
                      <span className="mt-1 block break-words text-[12.5px] font-medium leading-5 text-foreground">
                        {dashboardTaskTitle(task, lang)}
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
              })}
              </>
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
      ) : null}

      {quickLinks.length > 0 || quickLinksUnavailable ? (
        <section data-testid="role-cabinet-quick-links" className="staff-overview-card min-w-0 p-4">
          <h2><SectionHeading icon={LayoutGrid}>{copy.quick}</SectionHeading></h2>
          {quickLinksUnavailable && <p className="mt-2 text-sm text-muted-foreground">{tr.cabinet_quick_links_empty}</p>}
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {quickLinks.map((item) => {
              const Icon = navItemIcon(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`role-cabinet-link-${item.id}`}
                  onClick={() => staffGo(item.to)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-left",
                    "transition-colors hover:border-foreground/30",
                  )}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-foreground" />
                  <span className="min-w-0 flex-1 break-words text-[13px] font-medium text-foreground">
                    {tr[item.labelKey] ?? item.id}
                  </span>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
