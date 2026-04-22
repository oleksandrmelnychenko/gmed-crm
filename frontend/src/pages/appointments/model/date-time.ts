import {
  CALENDAR_STORAGE_DATE_KEY,
  CALENDAR_STORAGE_VIEW_KEY,
} from "./constants";
import type { CalendarView } from "./types";

export function currentDateInput(): string {
  return new Date().toLocaleDateString("en-CA");
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
