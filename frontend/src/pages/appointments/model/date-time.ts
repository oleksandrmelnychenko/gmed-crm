import {
  CALENDAR_STORAGE_DATE_KEY,
  CALENDAR_STORAGE_VIEW_KEY,
} from "./constants";
import type { CalendarView } from "./types";

const BERLIN_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function currentDateInput(date = new Date()): string {
  const parts = BERLIN_DATE_FORMATTER.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
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

export function toDateInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

export function startOfWeekInput(anchorDate: string): string {
  const date = new Date(`${anchorDate}T12:00:00`);
  const diff = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - diff);
  return toDateInput(date);
}

export function endOfWeekInput(anchorDate: string): string {
  const start = new Date(`${startOfWeekInput(anchorDate)}T12:00:00`);
  start.setDate(start.getDate() + 6);
  return toDateInput(start);
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

  const month = new Date(`${anchorDate}T12:00:00`);
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12);
  return { dateFrom: toDateInput(first), dateTo: toDateInput(last) };
}

export function inclusiveCalendarVisibleRange(
  start: Date,
  exclusiveEnd: Date,
) {
  const inclusiveEnd = new Date(exclusiveEnd);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  return {
    dateFrom: toDateInput(start),
    dateTo: toDateInput(inclusiveEnd),
  };
}

export function toDateTimeLocalInput(
  dateTime: string | null | undefined,
): string {
  if (!dateTime) return "";
  const value = new Date(dateTime);
  if (Number.isNaN(value.getTime())) return "";
  const shifted = new Date(
    value.getTime() - value.getTimezoneOffset() * 60000,
  );
  return shifted.toISOString().slice(0, 16);
}

export function shiftLocalDateTime(
  localDateTime: string,
  adjustment: { days?: number; months?: number },
): string {
  if (!localDateTime) return "";
  const value = new Date(localDateTime);
  if (Number.isNaN(value.getTime())) return "";
  if (adjustment.days) {
    value.setDate(value.getDate() + adjustment.days);
  }
  if (adjustment.months) {
    value.setMonth(value.getMonth() + adjustment.months);
  }
  return toDateTimeLocalInput(value.toISOString());
}

export function toTimeInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(11, 16);
}
