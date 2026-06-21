import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  FileText,
  MoreHorizontal,
  UserPlus,
  Users as UsersIcon,
} from "lucide-react";

import {
  formatDay,
  formatMonth,
  formatShortDate,
} from "../../model/staff-dashboard-formatters";
import type { TaskItem, UpcomingAppointment } from "../../model/staff-dashboard-types";
import {
  PriorityDot,
  QuickLink,
  StatusDot,
  type DashboardTranslations,
} from "../shared/staff-dashboard-surface-primitives";

export function StaffDashboardActivitySection({
  loading,
  onOpenAppointment,
  onOpenAppointments,
  onOpenLeads,
  onOpenOrders,
  onOpenPatients,
  openTasksCount,
  tasks,
  tr,
  upcoming,
}: {
  loading: boolean;
  onOpenAppointment: (appointmentId: string) => void;
  onOpenAppointments: () => void;
  onOpenLeads: () => void;
  onOpenOrders: () => void;
  onOpenPatients: () => void;
  openTasksCount: number;
  tasks: TaskItem[];
  tr: DashboardTranslations;
  upcoming: UpcomingAppointment[];
}) {
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-muted-foreground" />
              <h3 className="text-[14px] font-semibold text-foreground">
                {tr.dash_upcoming ?? tr.common_unknown}
              </h3>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={onOpenAppointments}
            >
              {tr.dash_view_all ?? tr.common_unknown}
              <ArrowRight className="size-3" />
            </button>
          </div>
          <div className="divide-y divide-border">
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {tr.common_loading ?? tr.common_unknown}
              </div>
            ) : upcoming.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {tr.dash_no_upcoming ?? tr.common_unknown}
              </div>
            ) : (
              upcoming.slice(0, 6).map((appointment) => (
                <button
                  key={appointment.id}
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
                  onClick={() => onOpenAppointment(appointment.id)}
                >
                  <div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-lg bg-muted/60 text-center">
                    <span className="text-[9px] font-medium uppercase text-muted-foreground">
                      {formatMonth(appointment.date)}
                    </span>
                    <span className="text-[13px] font-semibold leading-tight">
                      {formatDay(appointment.date)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="min-w-0 max-w-full break-words text-[13px] font-medium text-foreground">
                      {appointment.title || appointment.patient_name}
                    </div>
                    <div className="min-w-0 max-w-full break-words text-[11.5px] text-muted-foreground">
                      {appointment.time_start ? `${appointment.time_start.slice(0, 5)} - ` : ""}
                      {appointment.patient_name}
                      {appointment.location ? ` - ${appointment.location}` : ""}
                    </div>
                  </div>
                  <StatusDot status={appointment.status} />
                </button>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-muted-foreground" />
              <h3 className="text-[14px] font-semibold text-foreground">
                {tr.dash_my_tasks ?? tr.common_unknown}
              </h3>
              {openTasksCount > 0 ? (
                <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--brand)]">
                  {openTasksCount}
                </span>
              ) : null}
            </div>
          </div>
          <div className="divide-y divide-border">
            {loading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {tr.common_loading ?? tr.common_unknown}
              </div>
            ) : tasks.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {tr.dash_no_tasks ?? tr.common_unknown}
              </div>
            ) : (
              tasks.slice(0, 6).map((task) => (
                <div
                  key={task.id}
                  className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
                >
                  <PriorityDot priority={task.priority} />
                  <div className="min-w-0 flex-1">
                    <div className="min-w-0 max-w-full break-words text-[13px] font-medium text-foreground">
                      {task.title}
                    </div>
                    <div className="min-w-0 max-w-full break-words text-[11.5px] text-muted-foreground">
                      {task.due_date
                        ? `${tr.dash_due ?? tr.common_unknown} ${formatShortDate(task.due_date)}`
                        : tr.dash_no_due ?? tr.common_unknown}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <QuickLink icon={UsersIcon} label={tr.patients_title ?? tr.common_unknown} onClick={onOpenPatients} />
        <QuickLink icon={UserPlus} label={tr.leads_title ?? tr.common_unknown} onClick={onOpenLeads} />
        <QuickLink
          icon={CalendarDays}
          label={tr.appointments_title ?? tr.common_unknown}
          onClick={onOpenAppointments}
        />
        <QuickLink icon={FileText} label={tr.orders_title ?? tr.common_unknown} onClick={onOpenOrders} />
      </div>
    </>
  );
}
