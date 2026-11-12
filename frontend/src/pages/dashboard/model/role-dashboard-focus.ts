import { appDateKey } from "@/lib/app-time-zone";
import type { Lang } from "@/lib/i18n";
import { localizeTaskTitle } from "@/lib/task-labels";
import {
  conciergeTaskScheduledAt,
  isConciergeTaskActive,
  isConciergeTaskOverdue,
  type ConciergeTask,
} from "@/pages/concierge/model";

const PRIORITY_WEIGHT: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Whether two instants fall on the same Berlin calendar day. */
function isSameAppDay(left: Date, right: Date): boolean {
  return appDateKey(left) === appDateKey(right);
}

/**
 * The title of a task in a dashboard list. System tasks carry an English
 * template ("Order checklist: …") that is translated from the UI text
 * catalog, the same way the task manager shows it.
 */
export function dashboardTaskTitle(task: Pick<ConciergeTask, "title">, lang: Lang): string {
  return localizeTaskTitle(task.title, lang);
}

export function isConciergeTaskDueToday(task: ConciergeTask, now: Date): boolean {
  const scheduledAt = conciergeTaskScheduledAt(task);
  return Boolean(
    scheduledAt
      && isConciergeTaskActive(task)
      && isSameAppDay(scheduledAt, now),
  );
}

/**
 * Whether a task belongs to "Фокус на сегодня": overdue, due today or
 * without a date. Work of a later Berlin day waits for its day (concierge
 * QA 2026-11-12 D-9).
 */
export function isConciergeTaskForToday(task: ConciergeTask, now: Date): boolean {
  const scheduledAt = conciergeTaskScheduledAt(task);
  if (!scheduledAt) return true;
  return appDateKey(scheduledAt) <= appDateKey(now) || isConciergeTaskOverdue(task, now);
}

/** A service the patient requested in the portal that nobody has booked yet. */
export type DashboardServiceRequest = {
  id: string;
  title: string;
  status: string;
  request_source: string;
  patient_name?: string | null;
  starts_at: string | null;
  booking_reference?: string | null;
  created_at?: string | null;
};

/**
 * The open portal requests of the concierge's services, soonest wish first:
 * a request has no task on the board until it is taken, so "Фокус на
 * сегодня" lists it itself (concierge QA 2026-11-12 D-2).
 */
export function openPatientServiceRequests(
  services: DashboardServiceRequest[],
  limit = 4,
): DashboardServiceRequest[] {
  const time = (value: string | null | undefined) =>
    value ? new Date(value).getTime() : Number.POSITIVE_INFINITY;
  return services
    .filter(
      (service) =>
        service.request_source === "patient_portal"
        && service.status === "planned"
        && !service.booking_reference,
    )
    .sort((left, right) =>
      time(left.starts_at) - time(right.starts_at)
      || time(left.created_at) - time(right.created_at))
    .slice(0, Math.max(0, limit));
}

export function roleDashboardFocusTasks(
  tasks: ConciergeTask[],
  now: Date,
  limit = 4,
): ConciergeTask[] {
  return tasks
    .filter((task) => !task.archived_at && isConciergeTaskActive(task))
    .filter((task) => isConciergeTaskForToday(task, now))
    .sort((left, right) => {
      const overdueDelta = Number(isConciergeTaskOverdue(right, now))
        - Number(isConciergeTaskOverdue(left, now));
      if (overdueDelta !== 0) return overdueDelta;

      const todayDelta = Number(isConciergeTaskDueToday(right, now))
        - Number(isConciergeTaskDueToday(left, now));
      if (todayDelta !== 0) return todayDelta;

      const priorityDelta = (PRIORITY_WEIGHT[left.priority] ?? 4)
        - (PRIORITY_WEIGHT[right.priority] ?? 4);
      if (priorityDelta !== 0) return priorityDelta;

      const leftDue = conciergeTaskScheduledAt(left)?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightDue = conciergeTaskScheduledAt(right)?.getTime() ?? Number.POSITIVE_INFINITY;
      if (leftDue !== rightDue) return leftDue - rightDue;

      return right.created_at.localeCompare(left.created_at);
    })
    .slice(0, Math.max(0, limit));
}

