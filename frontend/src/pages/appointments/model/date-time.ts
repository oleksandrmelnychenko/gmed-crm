import {
  addDaysToDateKey,
  addMonthsToDateKey,
  appDateKey,
  endOfMonthKey,
  isoToBerlinLocalInput,
  parseDateKey,
  startOfIsoWeekKey,
  startOfMonthKey,
} from "@/lib/app-time-zone";

import {
  CALENDAR_STORAGE_DATE_KEY,
  CALENDAR_STORAGE_VIEW_KEY,
} from "./constants";
import type { CalendarView } from "./types";

/** Today's clinic date in Europe/Berlin. */
export function currentDateInput(date = new Date()): string {
  return appDateKey(date);
}

export function hasPairedAppointmentTimes(
  timeStart: string | null | undefined,
  timeEnd: string | null | undefined,
): boolean {
  return Boolean(timeStart) === Boolean(timeEnd);
}

export function hasValidAppointmentTimeRange(
  timeStart: string | null | undefined,
  timeEnd: string | null | undefined,
): boolean {
  if (!hasPairedAppointmentTimes(timeStart, timeEnd)) return false;
  if (!timeStart && !timeEnd) return true;
  return Boolean(timeStart && timeEnd && timeEnd > timeStart);
}

export function normalizeAppointmentTimePair(
  timeStart: string | null | undefined,
  timeEnd: string | null | undefined,
) {
  if (!hasPairedAppointmentTimes(timeStart, timeEnd) || !timeStart || !timeEnd) {
    return { timeStart: null, timeEnd: null };
  }

  return { timeStart, timeEnd };
}

export function serializeAppointmentTimes(
  timeStart: string | null | undefined,
  timeEnd: string | null | undefined,
) {
  return {
    timeStart: timeStart || null,
    timeEnd: timeEnd || null,
  };
}

export function readStoredCalendarView(): CalendarView {
  if (typeof window === "undefined") return "timeGridWeek";
  const stored = window.localStorage.getItem(CALENDAR_STORAGE_VIEW_KEY);
  if (
    stored === "dayGridMonth" ||
    stored === "timeGridWeek" ||
    stored === "timeGridDay" ||
    stored === "listWeek"
  ) {
    return stored;
  }
  return "timeGridWeek";
}

export function readStoredCalendarDate(): string {
  if (typeof window === "undefined") return currentDateInput();
  return (
    window.localStorage.getItem(CALENDAR_STORAGE_DATE_KEY) ||
    currentDateInput()
  );
}

/**
 * "YYYY-MM-DD" of a FullCalendar date. The calendar runs in its default
 * "local" zone with naive (offset-less) Berlin wall times, so its Date objects
 * carry the Berlin wall clock in their local fields — read them locally.
 */
export function toDateInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

export function startOfWeekInput(anchorDate: string): string {
  return startOfIsoWeekKey(anchorDate);
}

export function endOfWeekInput(anchorDate: string): string {
  return addDaysToDateKey(startOfWeekInput(anchorDate), 6);
}

export function initialCalendarVisibleRange(
  view: CalendarView,
  anchorDate: string,
) {
  if (view === "timeGridDay") {
    return { dateFrom: anchorDate, dateTo: anchorDate };
  }
  if (view === "timeGridWeek" || view === "listWeek") {
    return {
      dateFrom: startOfWeekInput(anchorDate),
      dateTo: endOfWeekInput(anchorDate),
    };
  }

  return { dateFrom: startOfMonthKey(anchorDate), dateTo: endOfMonthKey(anchorDate) };
}

/** FullCalendar's visible range (exclusive end) as an inclusive API date range. */
export function inclusiveCalendarVisibleRange(
  start: Date,
  exclusiveEnd: Date,
) {
  return {
    dateFrom: toDateInput(start),
    dateTo: addDaysToDateKey(toDateInput(exclusiveEnd), -1),
  };
}

/** A timestamp as a `datetime-local` value in Berlin time. */
export function toDateTimeLocalInput(
  dateTime: string | null | undefined,
): string {
  return isoToBerlinLocalInput(dateTime);
}

const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

/**
 * Moves a naive Berlin "YYYY-MM-DDTHH:mm" value by whole days and months and
 * keeps its wall-clock time; a month step clamps to the month's last day.
 */
export function shiftLocalDateTime(
  localDateTime: string,
  adjustment: { days?: number; months?: number },
): string {
  const match = LOCAL_DATE_TIME.exec(localDateTime);
  if (!match || !parseDateKey(match[1])) return "";
  let date = match[1];
  if (adjustment.days) {
    date = addDaysToDateKey(date, adjustment.days);
  }
  if (adjustment.months) {
    date = addMonthsToDateKey(date, adjustment.months);
  }
  return `${date}T${match[2]}`;
}

/**
 * The same time slot moved by a calendar offset: start and end shift
 * together, so the new slot keeps the original duration.
 */
export function shiftAppointmentSlot(
  slot: { date: string; timeStart?: string | null; timeEnd?: string | null },
  adjustment: { days?: number; months?: number },
) {
  const start = shiftLocalDateTime(
    `${slot.date}T${(slot.timeStart ?? "09:00").slice(0, 5)}`,
    adjustment,
  );
  if (!start) return null;
  const end = slot.timeEnd
    ? shiftLocalDateTime(`${slot.date}T${slot.timeEnd.slice(0, 5)}`, adjustment)
    : "";
  return {
    date: start.slice(0, 10),
    timeStart: start.slice(11, 16),
    timeEnd: end ? end.slice(11, 16) : "",
    startsAt: start,
  };
}

/** "HH:mm" of a FullCalendar date (Berlin wall clock in its local fields, see `toDateInput`). */
export function toTimeInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(11, 16);
}
