import {
  addCalendarDays,
  startOfCalendarDay,
  startOfIsoWeek,
} from "@/lib/calendar-standards";

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
