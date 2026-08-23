import { describe, expect, it } from "vitest";

import {
  isoWeekNumber,
  startOfIsoWeek,
  taskCalendarDays,
  taskCalendarWeeks,
} from "./task-calendar";

describe("task manager ISO calendar", () => {
  it("starts a week containing Sunday on the preceding Monday", () => {
    const sunday = new Date(2026, 7, 23, 15, 30);
    const monday = startOfIsoWeek(sunday);

    expect(monday.getFullYear()).toBe(2026);
    expect(monday.getMonth()).toBe(7);
    expect(monday.getDate()).toBe(17);
    expect(monday.getDay()).toBe(1);
    expect(monday.getHours()).toBe(0);
  });

  it("returns Monday through Sunday for the week view", () => {
    const days = taskCalendarDays("week", new Date(2026, 7, 23));

    expect(days.map((day) => day.getDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(taskCalendarWeeks(days)).toHaveLength(1);
  });

  it("uses ISO week numbers across a year boundary", () => {
    expect(isoWeekNumber(new Date(2026, 11, 31))).toBe(53);
    expect(isoWeekNumber(new Date(2027, 0, 1))).toBe(53);
    expect(isoWeekNumber(new Date(2027, 0, 4))).toBe(1);
  });

  it("groups the month grid into six Monday-first weeks", () => {
    const weeks = taskCalendarWeeks(taskCalendarDays("month", new Date(2026, 7, 15)));

    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.every((week) => week[0]?.getDay() === 1)).toBe(true);
  });
});
