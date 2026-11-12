import type { EventInput } from "@fullcalendar/core";

/** The hours the week and day views show when no visit lies outside them. */
export const DEFAULT_TIMEGRID_START_HOUR = 6;
export const DEFAULT_TIMEGRID_END_HOUR = 22;
/** FullCalendar draws a timed event without an end as one hour long. */
const DEFAULT_EVENT_MINUTES = 60;

export type TimeGridHours = {
  slotMinTime: string;
  slotMaxTime: string;
};

function naiveParts(value: EventInput["start"]): { date: string; minutes: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return { date: match[1], minutes: Number(match[2]) * 60 + Number(match[3]) };
}

function hourTime(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00:00`;
}

/**
 * The visible hours of the week and day views: 06:00–22:00, widened to the
 * whole hour of the earliest start and the latest end of the timed visits in
 * the shown period, so that a night arrival or a late transfer is never
 * hidden or cut (concierge QA 2026-11-12, E F1). Events carry naive Berlin
 * wall times (`YYYY-MM-DDTHH:MM`); `rangeStart` (inclusive) and `rangeEnd`
 * (exclusive) are `YYYY-MM-DD` dates of the shown period.
 */
export function resolveTimeGridHours(
  events: EventInput[],
  rangeStart?: string | null,
  rangeEnd?: string | null,
): TimeGridHours {
  let startHour = DEFAULT_TIMEGRID_START_HOUR;
  let endHour = DEFAULT_TIMEGRID_END_HOUR;

  for (const event of events) {
    if (event.allDay) continue;
    const start = naiveParts(event.start);
    if (!start) continue;
    if (rangeStart && start.date < rangeStart) continue;
    if (rangeEnd && start.date >= rangeEnd) continue;

    const end = naiveParts(event.end);
    let endMinutes: number;
    if (!end) {
      endMinutes = start.minutes + DEFAULT_EVENT_MINUTES;
    } else if (end.date > start.date) {
      endMinutes = 24 * 60;
    } else {
      endMinutes = Math.max(end.minutes, start.minutes);
    }

    startHour = Math.min(startHour, Math.floor(start.minutes / 60));
    endHour = Math.max(endHour, Math.min(24, Math.ceil(endMinutes / 60)));
  }

  return { slotMinTime: hourTime(startHour), slotMaxTime: hourTime(endHour) };
}
