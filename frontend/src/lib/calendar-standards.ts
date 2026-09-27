import {
  addDaysToDateKey,
  appDateKey,
  appDayStart,
  appWallClock,
  appWallClockToInstant,
  dateKeyWeekday,
  parseDateKey,
  startOfIsoWeekKey,
} from "@/lib/app-time-zone";

/** GMED calendars follow ISO 8601: Monday is the first day of the week. */
export const CALENDAR_FIRST_DAY = 1;

/** FullCalendar accepts the string "ISO" for ISO-8601 week numbering. */
export const CALENDAR_WEEK_NUMBER_CALCULATION = "ISO" as const;

// Calendar days are Berlin days: a day is the instant of its Berlin midnight,
// whatever time zone the browser runs in.

/** Berlin midnight of the day containing `date`. */
export function startOfCalendarDay(date: Date) {
  return appDayStart(appDateKey(date));
}

/** The same Berlin wall-clock time `amount` calendar days later (DST-safe). */
export function addCalendarDays(date: Date, amount: number) {
  const { hour, minute, second } = appWallClock(date);
  const target = parseDateKey(addDaysToDateKey(appDateKey(date), amount));
  if (!target) return new Date(Number.NaN);
  const next = appWallClockToInstant(target.year, target.month, target.day, hour, minute, second);
  return new Date(next.getTime() + date.getUTCMilliseconds());
}

/** Returns Monday 00:00 Berlin for the ISO week containing `date`. */
export function startOfIsoWeek(date: Date) {
  return appDayStart(startOfIsoWeekKey(appDateKey(date)));
}

/** ISO-8601 week number of the Berlin day: weeks start on Monday and week 1 contains 4 January. */
export function isoWeekNumber(date: Date) {
  const key = appDateKey(date);
  const target = new Date(`${addDaysToDateKey(key, 4 - (dateKeyWeekday(key) || 7))}T00:00:00Z`);
  const isoYearStart = Date.UTC(target.getUTCFullYear(), 0, 1);
  return Math.ceil(((target.getTime() - isoYearStart) / 86_400_000 + 1) / 7);
}
