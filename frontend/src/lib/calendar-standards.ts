/** GMED calendars follow ISO 8601: Monday is the first day of the week. */
export const CALENDAR_FIRST_DAY = 1;

/** FullCalendar accepts the string "ISO" for ISO-8601 week numbering. */
export const CALENDAR_WEEK_NUMBER_CALCULATION = "ISO" as const;

export function startOfCalendarDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addCalendarDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

/** Returns Monday 00:00 for the ISO week containing `date`. */
export function startOfIsoWeek(date: Date) {
  const mondayOffset = (date.getDay() + 6) % 7;
  return addCalendarDays(startOfCalendarDay(date), -mondayOffset);
}

/** ISO-8601 week number: weeks start on Monday and week 1 contains 4 January. */
export function isoWeekNumber(date: Date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const isoDay = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - isoDay);
  const isoYearStart = Date.UTC(target.getUTCFullYear(), 0, 1);
  return Math.ceil(((target.getTime() - isoYearStart) / 86_400_000 + 1) / 7);
}
