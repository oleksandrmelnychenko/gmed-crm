export function parseValidInterpreterReportHours(value: string): number | null {
  const hours = Number(value);
  const quarterHours = hours * 4;
  return Number.isFinite(hours) &&
    hours >= 0.25 &&
    hours <= 24 &&
    Math.abs(quarterHours - Math.round(quarterHours)) < 1e-9
    ? hours
    : null;
}
