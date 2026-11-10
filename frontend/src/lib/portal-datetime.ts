import { formatAppDate, formatAppDateTime, formatAppTime } from "./app-time-zone";

/** Display a Berlin timestamp compactly; a calendar date has no clock. */
export function formatPortalTimestamp(value?: string | null): string {
  return formatAppDateTime(value).replace(" ", " · ");
}

export function formatPortalTimeWindow(start?: string | null, end?: string | null): string {
  const from = formatPortalTimestamp(start);
  const to = formatPortalTimestamp(end);
  if (!from || !to) return from || to;
  if (start && end && formatAppDate(start) === formatAppDate(end)) {
    const first = formatAppTime(start);
    const last = formatAppTime(end);
    if (first && last) return from + "–" + last;
    if (!first && !last) return from;
  }
  return from + " – " + to;
}
