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
