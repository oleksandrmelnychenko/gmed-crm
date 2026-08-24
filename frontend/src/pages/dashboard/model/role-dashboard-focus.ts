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

function isSameLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

export function isConciergeTaskDueToday(task: ConciergeTask, now: Date): boolean {
  const scheduledAt = conciergeTaskScheduledAt(task);
  return Boolean(
    scheduledAt
      && isConciergeTaskActive(task)
      && isSameLocalDay(scheduledAt, now),
  );
}

export function roleDashboardFocusTasks(
  tasks: ConciergeTask[],
  now: Date,
  limit = 4,
): ConciergeTask[] {
  return tasks
    .filter((task) => !task.archived_at && isConciergeTaskActive(task))
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

