import {
  addCalendarDays,
  startOfCalendarDay,
  startOfIsoWeek,
} from "@/lib/calendar-standards";
import { conciergeTaskInterval, type ConciergeTask } from "./model";

export { isoWeekNumber, startOfIsoWeek } from "@/lib/calendar-standards";

export type TaskCalendarScale = "day" | "week" | "month";

export function startOfTaskCalendarDay(date: Date) {
  return startOfCalendarDay(date);
}

export function addTaskCalendarDays(date: Date, amount: number) {
  return addCalendarDays(date, amount);
}

export function taskCalendarDays(scale: TaskCalendarScale, focus: Date) {
  if (scale === "day") return [startOfTaskCalendarDay(focus)];
  if (scale === "week") {
    const start = startOfIsoWeek(focus);
    return Array.from({ length: 7 }, (_, index) => addTaskCalendarDays(start, index));
  }

  const first = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const start = startOfIsoWeek(first);
  return Array.from({ length: 42 }, (_, index) => addTaskCalendarDays(start, index));
}

export function taskCalendarWeeks(days: Date[]) {
  const weeks: Date[][] = [];
  for (let index = 0; index < days.length; index += 7) {
    weeks.push(days.slice(index, index + 7));
  }
  return weeks;
}

/** End timestamps are exclusive: midnight does not spill into the next day. */
export function taskOccursOnDay(task: ConciergeTask, day: Date) {
  const { start, end } = conciergeTaskInterval(task);
  const first = start ?? end;
  const last = end ?? start;
  if (!first || !last) return false;
  const dayStart = startOfTaskCalendarDay(day);
  const dayEnd = addTaskCalendarDays(dayStart, 1);
  return first < dayEnd && (first.getTime() === last.getTime() ? last >= dayStart : last > dayStart);
}

export function orderedTaskHierarchy(tasks: ConciergeTask[]) {
  const visible = new Set(tasks.map((task) => task.id));
  const visited = new Set<string>();
  const rows: { task: ConciergeTask; depth: number }[] = [];
  const children = new Map<string, ConciergeTask[]>();
  tasks.forEach((task) => {
    if (task.parent_task_id) children.set(task.parent_task_id, [...(children.get(task.parent_task_id) ?? []), task]);
  });
  function visit(task: ConciergeTask, depth: number) {
    if (visited.has(task.id)) return;
    visited.add(task.id);
    rows.push({ task, depth });
    children.get(task.id)?.forEach((child) => visit(child, depth + 1));
  }
  tasks.filter((task) => !task.parent_task_id || !visible.has(task.parent_task_id)).forEach((task) => visit(task, 0));
  tasks.forEach((task) => visit(task, 0));
  return rows;
}

export type TaskTimelineSpan = {
  start: Date;
  end: Date;
  /** The task has no planned start; the bar begins where the task was created. */
  impliedStart: boolean;
  /** Open past its deadline (or without one): the bar keeps running until it is stopped. */
  running: boolean;
};

/**
 * The bar the timeline draws for a task: from the planned start (or creation)
 * until the deadline, the completion, or — while the task is still open —
 * today, so nothing "falls off" the week just because its date has passed.
 */
export function taskTimelineSpan(
  task: Pick<ConciergeTask, "kind" | "starts_at" | "ends_at" | "due_at" | "status" | "completed_at" | "created_at">,
  now: Date,
): TaskTimelineSpan | null {
  const { start: plannedStart, end: plannedEnd } = conciergeTaskInterval(task);
  const created = task.created_at ? new Date(task.created_at) : null;
  const start = plannedStart ?? (created && !Number.isNaN(created.getTime()) ? created : null) ?? plannedEnd;
  if (!start) return null;

  const closed = task.status === "completed" || task.status === "cancelled";
  const completed = task.completed_at ? new Date(task.completed_at) : null;
  let end: Date;
  let running = false;
  if (closed) {
    end = completed && !Number.isNaN(completed.getTime()) ? completed : (plannedEnd ?? start);
  } else if (plannedEnd && plannedEnd > now) {
    end = plannedEnd;
  } else {
    end = now;
    running = true;
  }
  if (end < start) end = start;
  return { start, end, impliedStart: plannedStart === null, running };
}

/** Grid columns (0-based, inclusive) a span covers within the visible days, or null when it lies outside. */
export function taskTimelineColumns(span: TaskTimelineSpan, days: Date[]) {
  if (days.length === 0) return null;
  const first = startOfTaskCalendarDay(days[0]);
  const last = addTaskCalendarDays(startOfTaskCalendarDay(days[days.length - 1]), 1);
  if (span.end < first || span.start >= last) return null;
  const from = days.findIndex((day) => span.start < addTaskCalendarDays(startOfTaskCalendarDay(day), 1));
  let to = days.length - 1;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const dayStart = startOfTaskCalendarDay(days[index]);
    if (span.end > dayStart || (span.end.getTime() === span.start.getTime() && span.end >= dayStart)) {
      to = index;
      break;
    }
  }
  return { from: Math.max(from, 0), to: Math.max(to, Math.max(from, 0)), continuesBefore: span.start < first, continuesAfter: span.end >= last };
}
