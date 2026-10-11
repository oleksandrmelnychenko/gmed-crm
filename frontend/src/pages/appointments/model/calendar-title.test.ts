import { describe, expect, it } from "vitest";

import {
  appointmentCalendarTitleViews,
  calendarDayTitle,
  calendarMonthTitle,
  calendarRangeTitle,
} from "./calendar-title";

const day = (year: number, month: number, date: number) => ({ year, month: month - 1, day: date });

describe("appointment calendar title", () => {
  it("names the month in full instead of 'Окт. 2026 Г.'", () => {
    expect(calendarMonthTitle(day(2026, 10, 1), "ru")).toBe("Октябрь 2026");
    expect(calendarMonthTitle(day(2026, 3, 1), "de")).toBe("März 2026");
  });

  it("titles a week inside one month", () => {
    expect(calendarRangeTitle(day(2026, 10, 5), day(2026, 10, 11), "ru")).toBe("5–11 октября 2026");
    expect(calendarRangeTitle(day(2026, 10, 5), day(2026, 10, 11), "de")).toBe("5.–11. Oktober 2026");
  });

  it("titles weeks across months and years", () => {
    expect(calendarRangeTitle(day(2026, 9, 28), day(2026, 10, 4), "ru")).toBe("28 сентября – 4 октября 2026");
    expect(calendarRangeTitle(day(2026, 12, 28), day(2027, 1, 3), "de")).toBe(
      "28. Dezember 2026 – 3. Januar 2027",
    );
  });

  it("titles a single day", () => {
    expect(calendarDayTitle(day(2026, 10, 11), "ru")).toBe("11 октября 2026");
    expect(calendarRangeTitle(day(2026, 10, 11), day(2026, 10, 11), "de")).toBe("11. Oktober 2026");
  });

  it("gives every calendar view its title formatter", () => {
    const views = appointmentCalendarTitleViews("ru");

    expect(views.dayGridMonth.titleFormat({ start: day(2026, 10, 1), end: day(2026, 10, 31) })).toBe("Октябрь 2026");
    expect(views.timeGridWeek.titleFormat({ start: day(2026, 10, 5), end: day(2026, 10, 11) })).toBe(
      "5–11 октября 2026",
    );
    expect(views.timeGridDay.titleFormat({ start: day(2026, 10, 11) })).toBe("11 октября 2026");
  });
});
