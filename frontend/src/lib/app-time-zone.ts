/**
 * GMED works in German time only: every date and time staff see or enter is
 * Europe/Berlin wall-clock time, whatever time zone the browser runs in (staff
 * also open the app from Ukraine).
 *
 * Value shapes and how to handle them:
 * - Instants (RFC 3339 timestamps from timestamptz columns): format with
 *   `appDateTimeFormat`, fill `datetime-local` inputs with
 *   `isoToBerlinLocalInput` and save them with `berlinLocalInputToIso`.
 * - Calendar dates ("YYYY-MM-DD", no zone): keep them as date keys; turn them
 *   into a `Date` only through `dateKeyToDate` (12:00 UTC is the same day in
 *   Berlin and in UTC). Never `new Date(y, m, d)` or `new Date("…T00:00")`:
 *   those are browser-local midnight and render as the previous day in Berlin
 *   when the browser is east of Germany.
 * - Appointment wall times ("HH:MM[:SS]" next to a date): already Berlin time,
 *   shown as-is and never shifted.
 * - "Today" is `appDateKey()`, never a browser-local getter.
 */

export const APP_TIME_ZONE = "Europe/Berlin";

const DAY_MS = 86_400_000;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * A cached `Intl.DateTimeFormat` that renders in the app time zone. An
 * explicit `timeZone` (e.g. "UTC" for a calendar date parsed at UTC midnight)
 * is kept. Table cells and list rows format hundreds of values per render, so
 * instances are reused.
 */
export function appDateTimeFormat(
  locale: string | undefined,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const resolved: Intl.DateTimeFormatOptions = {
    ...options,
    timeZone: options?.timeZone ?? APP_TIME_ZONE,
  };
  const key = `${locale ?? ""}:${JSON.stringify(resolved)}`;
  let formatter = dateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, resolved);
    dateTimeFormatters.set(key, formatter);
  }
  return formatter;
}

const WALL_CLOCK_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Berlin wall-clock reading of an instant. `month` is 1-12, `weekday` 0 = Sunday like `Date#getDay`. */
export type AppWallClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

/** Berlin wall-clock parts of an instant. Throws a RangeError for an invalid date, like `Intl`. */
export function appWallClock(date: Date | number = new Date()): AppWallClock {
  const values: Record<string, number> = {};
  for (const part of WALL_CLOCK_FORMATTER.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const { year, month, day, minute, second } = values;
  // Some engines print midnight as 24 even with h23.
  const hour = values.hour === 24 ? 0 : values.hour;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function formatKey(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The Berlin calendar date of an instant as "YYYY-MM-DD" — `appDateKey()` is today. */
export function appDateKey(date: Date | number = new Date()): string {
  const { year, month, day } = appWallClock(date);
  return formatKey(year, month, day);
}

/**
 * The Berlin date of a timestamp string, or the date key itself when the
 * value is already a calendar date. "" for empty or unparseable values.
 */
export function appDateKeyOf(value: string | null | undefined): string {
  if (!value) return "";
  if (DATE_KEY.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : appDateKey(date);
}

/** "YYYY-MM-DDTHH:mm:ss" Berlin wall clock without an offset, e.g. FullCalendar's `now`. */
export function berlinNowNaive(date: Date | number = new Date()): string {
  const { year, month, day, hour, minute, second } = appWallClock(date);
  return `${formatKey(year, month, day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/** Berlin UTC offset in milliseconds at an instant (+1 h in winter, +2 h in summer). */
function appOffsetMs(epochMs: number): number {
  const wholeSeconds = Math.floor(epochMs / 1000) * 1000;
  const { year, month, day, hour, minute, second } = appWallClock(wholeSeconds);
  return Date.UTC(year, month - 1, day, hour, minute, second) - wholeSeconds;
}

/**
 * The instant at which Berlin clocks show the given wall time.
 *
 * DST is resolved like Temporal's "compatible" disambiguation:
 * - a time skipped in spring (2026-03-29 02:30) moves forward by the gap and
 *   becomes 03:30 CEST;
 * - a time repeated in autumn (2026-10-25 02:30) is the first occurrence,
 *   02:30 CEST (00:30 UTC), not 02:30 CET.
 */
export function appWallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // Berlin switches offsets months apart, so the offsets one day either side
  // cover both sides of any transition next to this wall time.
  const offsetBefore = appOffsetMs(asUtc - DAY_MS);
  const offsetAfter = appOffsetMs(asUtc + DAY_MS);
  const matches = [offsetBefore, offsetAfter]
    .map((offset) => asUtc - offset)
    .filter((instant) => asUtc - instant === appOffsetMs(instant));
  if (matches.length > 0) return new Date(Math.min(...matches));
  return new Date(asUtc - offsetBefore);
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * The instant of a `datetime-local` value ("YYYY-MM-DDTHH:mm[:ss]") read as
 * Berlin wall-clock time; null for empty or invalid input.
 */
export function parseBerlinLocalInput(value: string | null | undefined): Date | null {
  const match = value ? LOCAL_INPUT.exec(value.trim()) : null;
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = match[6] ? Number(match[6]) : 0;
  if (!validCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  return appWallClockToInstant(year, month, day, hour, minute, second);
}

/** A `datetime-local` value read as Berlin time, as a UTC ISO instant; null for empty or invalid input. */
export function berlinLocalInputToIso(value: string | null | undefined): string | null {
  return parseBerlinLocalInput(value)?.toISOString() ?? null;
}

/** "YYYY-MM-DDTHH:mm" Berlin wall clock of an instant for a `datetime-local` input; "" for empty or invalid input. */
export function isoToBerlinLocalInput(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const { year, month, day, hour, minute } = appWallClock(date);
  return `${formatKey(year, month, day)}T${pad(hour)}:${pad(minute)}`;
}

/** Year, month (1-12) and day of a "YYYY-MM-DD" key; null when it is not a real calendar date. */
export function parseDateKey(
  key: string | null | undefined,
): { year: number; month: number; day: number } | null {
  const match = key ? DATE_KEY.exec(key) : null;
  if (!match) return null;
  const [year, month, day] = match.slice(1, 4).map(Number);
  return validCalendarDate(year, month, day) ? { year, month, day } : null;
}

/**
 * A calendar date as a `Date` at 12:00 UTC, which is the same day in Berlin
 * and in UTC — format it with `appDateTimeFormat` (or timeZone "UTC"). Null
 * when the key is not a real "YYYY-MM-DD" date.
 */
export function dateKeyToDate(key: string | null | undefined): Date | null {
  const parts = parseDateKey(key);
  return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)) : null;
}

/**
 * A value that is either a calendar date ("YYYY-MM-DD") or a timestamp, as a
 * `Date` that formats correctly in the app time zone. Unparseable input gives
 * an invalid `Date`, like `new Date(value)`.
 */
export function dateOrInstant(value: string): Date {
  if (DATE_KEY.test(value)) return dateKeyToDate(value) ?? new Date(Number.NaN);
  return new Date(value);
}

function utcDateParts(date: Date) {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function keyFromUtc(date: Date): string {
  return formatKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function utcDateOfKey(key: string): Date {
  const parts = parseDateKey(key);
  if (!parts) throw new RangeError(`Invalid date key: ${key}`);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

/** Calendar arithmetic on "YYYY-MM-DD" keys, independent of any time zone. */
export function addDaysToDateKey(key: string, days: number): string {
  const date = utcDateOfKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return keyFromUtc(date);
}

/** Adds calendar months; the day is clamped to the target month (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsToDateKey(key: string, months: number): string {
  const { year, month, day } = utcDateParts(utcDateOfKey(key));
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return keyFromUtc(target);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetweenDateKeys(from: string, to: string): number {
  return Math.round((utcDateOfKey(to).getTime() - utcDateOfKey(from).getTime()) / DAY_MS);
}

/** Day of the week of a date key, 0 = Sunday like `Date#getDay`. */
export function dateKeyWeekday(key: string): number {
  return utcDateOfKey(key).getUTCDay();
}

/** The Monday of the ISO week containing the date key. */
export function startOfIsoWeekKey(key: string): string {
  return addDaysToDateKey(key, -((dateKeyWeekday(key) + 6) % 7));
}

/** The first day of the month of a date key. */
export function startOfMonthKey(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

/** The last day of the month of a date key. */
export function endOfMonthKey(key: string): string {
  return addDaysToDateKey(addMonthsToDateKey(startOfMonthKey(key), 1), -1);
}

/** The instant at which the Berlin calendar day begins (00:00 Berlin). */
export function appDayStart(key: string): Date {
  const { year, month, day } = utcDateParts(utcDateOfKey(key));
  return appWallClockToInstant(year, month, day);
}

/** The instant at which the Berlin calendar day ends — the next day's 00:00, exclusive. */
export function appDayEnd(key: string): Date {
  return appDayStart(addDaysToDateKey(key, 1));
}

/**
 * Formats a calendar date ("YYYY-MM-DD") without any time-zone shift; ""
 * when the value is not a date key.
 */
export function formatDateKey(
  key: string | null | undefined,
  locale: string | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = dateKeyToDate(key);
  return date ? appDateTimeFormat(locale, options).format(date) : "";
}
