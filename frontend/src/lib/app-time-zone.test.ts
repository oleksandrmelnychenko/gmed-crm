import { describe, expect, it } from "vitest";

import {
  APP_TIME_ZONE,
  addDaysToDateKey,
  addMonthsToDateKey,
  appDateKey,
  appDateKeyOf,
  appDateTimeFormat,
  appDayEnd,
  appDayStart,
  appWallClock,
  berlinLocalInputToIso,
  berlinNowNaive,
  dateKeyToDate,
  dateKeyWeekday,
  dateOrInstant,
  daysBetweenDateKeys,
  endOfMonthKey,
  formatAppDate,
  formatAppDateTime,
  formatAppTime,
  formatDateKey,
  isoToBerlinLocalInput,
  parseBerlinLocalInput,
  parseDateKey,
  startOfIsoWeekKey,
} from "./app-time-zone";
import { cachedDateTimeFormat } from "./intl-cache";

// The suite runs in whatever zone the machine has (Europe/Kyiv on the dev
// machine, UTC in CI). The instants below are chosen so that a helper reading
// browser-local time fails in at least one of them: 21:30Z on 27 Sep is still
// the 27th in Berlin but already the 28th in Kyiv; 22:30Z is the 28th in
// Berlin but still the 27th in UTC.
const BERLIN_27_KYIV_28 = new Date("2026-09-27T21:30:00Z");
const BERLIN_28_UTC_27 = new Date("2026-09-27T22:30:00Z");

describe("app time zone", () => {
  it("is Germany", () => {
    expect(APP_TIME_ZONE).toBe("Europe/Berlin");
  });

  it("formats instants in Berlin time, not in the browser zone", () => {
    const format = appDateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(format.format(BERLIN_27_KYIV_28)).toBe("27.09.2026, 23:30");
    expect(format.format(BERLIN_28_UTC_27)).toBe("28.09.2026, 00:30");
    expect(format.resolvedOptions().timeZone).toBe("Europe/Berlin");
  });

  it("keeps an explicit time zone", () => {
    const format = appDateTimeFormat("de-DE", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
    expect(format.format(BERLIN_28_UTC_27)).toBe("22:30");
  });

  it("reuses formatters, including through the shared intl cache", () => {
    const options = { dateStyle: "short" } as const;
    expect(appDateTimeFormat("ru-RU", options)).toBe(appDateTimeFormat("ru-RU", { dateStyle: "short" }));
    expect(cachedDateTimeFormat("ru-RU", options)).toBe(appDateTimeFormat("ru-RU", options));
    expect(cachedDateTimeFormat("de-DE").resolvedOptions().timeZone).toBe("Europe/Berlin");
  });

  it("reads Berlin wall-clock parts and today's Berlin date", () => {
    expect(appWallClock(BERLIN_27_KYIV_28)).toEqual({
      year: 2026,
      month: 9,
      day: 27,
      hour: 23,
      minute: 30,
      second: 0,
      weekday: 0,
    });
    expect(appDateKey(BERLIN_27_KYIV_28)).toBe("2026-09-27");
    expect(appDateKey(BERLIN_28_UTC_27)).toBe("2026-09-28");
    expect(appWallClock(BERLIN_28_UTC_27).hour).toBe(0);
    expect(appDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("finds the Berlin date of timestamps and passes calendar dates through", () => {
    expect(appDateKeyOf("2026-09-27T22:30:00Z")).toBe("2026-09-28");
    expect(appDateKeyOf("2026-09-27")).toBe("2026-09-27");
    expect(appDateKeyOf("")).toBe("");
    expect(appDateKeyOf("not a date")).toBe("");
  });

  it("gives FullCalendar a naive Berlin now", () => {
    expect(berlinNowNaive(BERLIN_28_UTC_27)).toBe("2026-09-28T00:30:00");
    expect(berlinNowNaive(new Date("2026-01-15T11:05:09Z"))).toBe("2026-01-15T12:05:09");
  });

  it("round-trips datetime-local values as Berlin time in summer and winter", () => {
    expect(berlinLocalInputToIso("2026-09-28T00:30")).toBe("2026-09-27T22:30:00.000Z");
    expect(berlinLocalInputToIso("2026-01-15T12:05")).toBe("2026-01-15T11:05:00.000Z");
    expect(berlinLocalInputToIso("2026-01-15T12:05:30")).toBe("2026-01-15T11:05:30.000Z");
    expect(isoToBerlinLocalInput("2026-09-27T22:30:00Z")).toBe("2026-09-28T00:30");
    expect(isoToBerlinLocalInput("2026-09-27T22:30:00+00:00")).toBe("2026-09-28T00:30");
    expect(isoToBerlinLocalInput(new Date("2026-01-15T11:05:00Z"))).toBe("2026-01-15T12:05");
  });

  it("rejects empty and impossible datetime-local values", () => {
    expect(berlinLocalInputToIso("")).toBeNull();
    expect(berlinLocalInputToIso(null)).toBeNull();
    expect(berlinLocalInputToIso("2026-02-30T10:00")).toBeNull();
    expect(berlinLocalInputToIso("2026-02-10T24:00")).toBeNull();
    expect(berlinLocalInputToIso("2026-02-10")).toBeNull();
    expect(isoToBerlinLocalInput("")).toBe("");
    expect(isoToBerlinLocalInput(undefined)).toBe("");
    expect(isoToBerlinLocalInput("garbage")).toBe("");
  });

  describe("spring forward, 2026-03-29 (02:00 CET → 03:00 CEST)", () => {
    it("maps the wall times around the gap", () => {
      expect(berlinLocalInputToIso("2026-03-29T01:59")).toBe("2026-03-29T00:59:00.000Z");
      expect(berlinLocalInputToIso("2026-03-29T03:00")).toBe("2026-03-29T01:00:00.000Z");
      expect(isoToBerlinLocalInput("2026-03-29T00:59:00Z")).toBe("2026-03-29T01:59");
      expect(isoToBerlinLocalInput("2026-03-29T01:00:00Z")).toBe("2026-03-29T03:00");
    });

    it("moves a skipped wall time forward by the gap", () => {
      expect(berlinLocalInputToIso("2026-03-29T02:30")).toBe("2026-03-29T01:30:00.000Z");
      expect(isoToBerlinLocalInput(parseBerlinLocalInput("2026-03-29T02:30"))).toBe("2026-03-29T03:30");
    });

    it("keeps the Berlin day 23 hours long", () => {
      expect(appDayStart("2026-03-29").toISOString()).toBe("2026-03-28T23:00:00.000Z");
      expect(appDayEnd("2026-03-29").toISOString()).toBe("2026-03-29T22:00:00.000Z");
    });
  });

  describe("fall back, 2026-10-25 (03:00 CEST → 02:00 CET)", () => {
    it("picks the first occurrence of a repeated wall time", () => {
      expect(berlinLocalInputToIso("2026-10-25T02:30")).toBe("2026-10-25T00:30:00.000Z");
      expect(isoToBerlinLocalInput("2026-10-25T00:30:00Z")).toBe("2026-10-25T02:30");
      expect(isoToBerlinLocalInput("2026-10-25T01:30:00Z")).toBe("2026-10-25T02:30");
    });

    it("maps the wall times around the overlap", () => {
      expect(berlinLocalInputToIso("2026-10-25T01:30")).toBe("2026-10-24T23:30:00.000Z");
      expect(berlinLocalInputToIso("2026-10-25T03:30")).toBe("2026-10-25T02:30:00.000Z");
    });

    it("keeps the Berlin day 25 hours long", () => {
      expect(appDayStart("2026-10-25").toISOString()).toBe("2026-10-24T22:00:00.000Z");
      expect(appDayEnd("2026-10-25").toISOString()).toBe("2026-10-25T23:00:00.000Z");
    });
  });

  it("turns calendar dates into Dates that format as the same day", () => {
    expect(dateKeyToDate("2026-09-27")?.toISOString()).toBe("2026-09-27T12:00:00.000Z");
    expect(dateKeyToDate("2026-02-30")).toBeNull();
    expect(dateKeyToDate("27.09.2026")).toBeNull();
    expect(formatDateKey("2026-09-27", "de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })).toBe(
      "27.09.2026",
    );
    expect(formatDateKey("2026-09-27", "ru-RU", { weekday: "short" })).toBe("вс");
    expect(formatDateKey(null, "de-DE")).toBe("");
    expect(parseDateKey("2026-12-31")).toEqual({ year: 2026, month: 12, day: 31 });
  });

  it("parses values that may be either a date or a timestamp", () => {
    const format = appDateTimeFormat("de-DE", { dateStyle: "short" });
    expect(format.format(dateOrInstant("2026-09-27"))).toBe("27.09.26");
    expect(format.format(dateOrInstant("2026-09-27T22:30:00Z"))).toBe("28.09.26");
    expect(Number.isNaN(dateOrInstant("nope").getTime())).toBe(true);
  });

  it("does calendar arithmetic on date keys", () => {
    expect(addDaysToDateKey("2026-09-27", 5)).toBe("2026-10-02");
    expect(addDaysToDateKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToDateKey("2026-10-24", 1)).toBe("2026-10-25");
    expect(addMonthsToDateKey("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDateKey("2026-11-15", 3)).toBe("2027-02-15");
    expect(addMonthsToDateKey("2026-03-31", -1)).toBe("2026-02-28");
    expect(daysBetweenDateKeys("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetweenDateKeys("2026-10-26", "2026-10-24")).toBe(-2);
    expect(dateKeyWeekday("2026-09-27")).toBe(0);
    expect(startOfIsoWeekKey("2026-09-27")).toBe("2026-09-21");
    expect(startOfIsoWeekKey("2026-09-21")).toBe("2026-09-21");
    expect(endOfMonthKey("2028-02-10")).toBe("2028-02-29");
  });
});

describe("app date display", () => {
  it("shows dates as DD.MM.YYYY in the Berlin day, never shifting calendar dates", () => {
    expect(formatAppDate("2026-09-28")).toBe("28.09.2026");
    expect(formatAppDate("2026-01-05")).toBe("05.01.2026");
    expect(formatAppDate(BERLIN_27_KYIV_28)).toBe("27.09.2026");
    expect(formatAppDate(BERLIN_28_UTC_27.toISOString())).toBe("28.09.2026");
    expect(formatAppDate(BERLIN_28_UTC_27.getTime())).toBe("28.09.2026");
    for (const value of [null, undefined, "", "  ", "nope", "2026-02-31"]) {
      expect(formatAppDate(value)).toBe("");
    }
  });

  it("shows date-times as DD.MM.YYYY HH:mm in Berlin time", () => {
    expect(formatAppDateTime(BERLIN_27_KYIV_28)).toBe("27.09.2026 23:30");
    expect(formatAppDateTime("2026-09-27T22:30:00Z")).toBe("28.09.2026 00:30");
    expect(formatAppDateTime("2026-01-15T07:05:00Z")).toBe("15.01.2026 08:05");
    // A calendar date has no time.
    expect(formatAppDateTime("2026-09-28")).toBe("28.09.2026");
    expect(formatAppDateTime("nope")).toBe("");
    expect(formatAppTime("2026-09-27T22:30:00Z")).toBe("00:30");
    expect(formatAppTime("2026-09-28")).toBe("");
  });
});
