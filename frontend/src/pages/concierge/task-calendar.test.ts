import { describe, expect, it } from "vitest";

import { appDateKey, appWallClock } from "@/lib/app-time-zone";

import {
  isSameTaskCalendarDay,
  isSameTaskCalendarMonth,
  isoWeekNumber,
  shiftTaskCalendarFocus,
  startOfIsoWeek,
  taskCalendarDays,
  taskCalendarWeeks,
} from "./task-calendar";

// Calendar days are Berlin days. Instants are built from UTC strings so the
// tests behave the same in any machine time zone (CI runs in UTC, staff
// machines in Europe/Kyiv).
const keys = (days: Date[]) => days.map((day) => appDateKey(day));

describe("task manager ISO calendar", () => {
  it("starts a week containing Sunday on the preceding Monday", () => {
    // Sunday 23 Aug 2026, 15:30 in Berlin.
    const sunday = new Date("2026-08-23T13:30:00Z");
    const monday = startOfIsoWeek(sunday);

    expect(monday.toISOString()).toBe("2026-08-16T22:00:00.000Z");
    expect(appWallClock(monday)).toMatchObject({ year: 2026, month: 8, day: 17, hour: 0, minute: 0, weekday: 1 });
  });

  it("reads the week from the Berlin day, not the browser's", () => {
    // Sunday 27 Sep 23:30 in Berlin, already Monday 28 Sep in Kyiv.
    expect(startOfIsoWeek(new Date("2026-09-27T21:30:00Z")).toISOString()).toBe("2026-09-20T22:00:00.000Z");
    // Monday 28 Sep 00:30 in Berlin, still Sunday 27 Sep in UTC.
    expect(startOfIsoWeek(new Date("2026-09-27T22:30:00Z")).toISOString()).toBe("2026-09-27T22:00:00.000Z");
  });

  it("returns Monday through Sunday for the week view", () => {
    const days = taskCalendarDays("week", new Date("2026-08-23T10:00:00Z"));

    expect(days.map((day) => appWallClock(day).weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(days.every((day) => appWallClock(day).hour === 0)).toBe(true);
    expect(keys(days)).toEqual(["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"]);
    expect(taskCalendarWeeks(days)).toHaveLength(1);
  });

  it("keeps Berlin midnights across the autumn clock change", () => {
    // 25 Oct 2026: Berlin switches from CEST to CET.
    const days = taskCalendarDays("week", new Date("2026-10-22T10:00:00Z"));

    expect(keys(days)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(days.every((day) => appWallClock(day).hour === 0)).toBe(true);
    expect(days[6].toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(taskCalendarDays("day", new Date("2026-10-26T12:00:00Z"))[0].toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("uses ISO week numbers across a year boundary", () => {
    expect(isoWeekNumber(new Date("2026-12-31T12:00:00Z"))).toBe(53);
    expect(isoWeekNumber(new Date("2027-01-01T12:00:00Z"))).toBe(53);
    expect(isoWeekNumber(new Date("2027-01-04T12:00:00Z"))).toBe(1);
    // Sunday 3 Jan 23:30 in Berlin (Monday in Kyiv) and Monday 4 Jan 00:30 in Berlin (Sunday in UTC).
    expect(isoWeekNumber(new Date("2027-01-03T22:30:00Z"))).toBe(53);
    expect(isoWeekNumber(new Date("2027-01-03T23:30:00Z"))).toBe(1);
  });

  it("groups the month grid into six Monday-first weeks", () => {
    const weeks = taskCalendarWeeks(taskCalendarDays("month", new Date("2026-08-15T10:00:00Z")));

    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.every((week) => appWallClock(week[0]).weekday === 1)).toBe(true);
    expect(appDateKey(weeks[0][0])).toBe("2026-07-27");
  });

  it("picks the month grid from the Berlin date of the focus", () => {
    // 30 Sep 23:30 in Berlin (1 Oct in Kyiv): September grid starting Monday 31 Aug.
    expect(appDateKey(taskCalendarDays("month", new Date("2026-09-30T21:30:00Z"))[0])).toBe("2026-08-31");
    // 1 Oct 00:30 in Berlin (30 Sep in UTC): October grid starting Monday 28 Sep.
    expect(appDateKey(taskCalendarDays("month", new Date("2026-09-30T22:30:00Z"))[0])).toBe("2026-09-28");
  });

  it("moves the focus by Berlin months, days and weeks", () => {
    // 31 Jan 10:00 in Berlin: next month clamps to 28 Feb.
    const focus = new Date("2026-01-31T09:00:00Z");
    expect(appDateKey(shiftTaskCalendarFocus(focus, "month", 1))).toBe("2026-02-28");
    expect(appDateKey(shiftTaskCalendarFocus(focus, "month", -1))).toBe("2025-12-31");
    expect(shiftTaskCalendarFocus(focus, "week", 1).toISOString()).toBe("2026-02-07T09:00:00.000Z");
    // Sunday 27 Sep 23:30 in Berlin: the next day is Monday 28 Sep, same wall time.
    expect(shiftTaskCalendarFocus(new Date("2026-09-27T21:30:00Z"), "day", 1).toISOString()).toBe("2026-09-28T21:30:00.000Z");
    // Across the autumn clock change the Berlin wall time stays 12:00.
    expect(shiftTaskCalendarFocus(new Date("2026-10-24T10:00:00Z"), "day", 1).toISOString()).toBe("2026-10-25T11:00:00.000Z");
  });

  it("compares days and months on the Berlin calendar", () => {
    const berlinLateSunday = new Date("2026-09-27T21:30:00Z");
    const berlinEarlyMonday = new Date("2026-09-27T22:30:00Z");
    expect(isSameTaskCalendarDay(berlinLateSunday, new Date("2026-09-26T22:30:00Z"))).toBe(true);
    expect(isSameTaskCalendarDay(berlinLateSunday, berlinEarlyMonday)).toBe(false);
    expect(isSameTaskCalendarMonth(new Date("2026-09-30T21:30:00Z"), new Date("2026-09-01T10:00:00Z"))).toBe(true);
    expect(isSameTaskCalendarMonth(new Date("2026-09-30T22:30:00Z"), new Date("2026-09-01T10:00:00Z"))).toBe(false);
  });
});
