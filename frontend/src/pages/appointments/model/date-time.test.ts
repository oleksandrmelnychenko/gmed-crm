import { describe, expect, it } from "vitest";

import {
  currentDateInput,
  normalizeAppointmentTimePair,
  serializeAppointmentTimes,
  inclusiveCalendarVisibleRange,
  initialCalendarVisibleRange,
  endOfWeekInput,
  startOfWeekInput,
  shiftAppointmentSlot,
} from "./date-time";

describe("appointment time serialization", () => {
  it("preserves one-sided payload values but omits them from conflict pairs", () => {
    expect(serializeAppointmentTimes("09:00", "")).toEqual({
      timeStart: "09:00",
      timeEnd: null,
    });
    expect(normalizeAppointmentTimePair("09:00", "")).toEqual({
      timeStart: null,
      timeEnd: null,
    });
  });
});

describe("appointment calendar date ranges", () => {
  it("uses the Europe/Berlin clinic date", () => {
    expect(currentDateInput(new Date("2026-07-16T22:30:00Z"))).toBe(
      "2026-07-17",
    );
  });

  it("converts FullCalendar's exclusive end to an inclusive API range", () => {
    expect(
      inclusiveCalendarVisibleRange(
        new Date("2026-07-13T00:00:00"),
        new Date("2026-07-20T00:00:00"),
      ),
    ).toEqual({
      dateFrom: "2026-07-13",
      dateTo: "2026-07-19",
    });
  });

  it("builds stable initial ranges for day, week and month views", () => {
    expect(initialCalendarVisibleRange("timeGridDay", "2026-07-17")).toEqual({
      dateFrom: "2026-07-17",
      dateTo: "2026-07-17",
    });
    expect(initialCalendarVisibleRange("timeGridWeek", "2026-07-17")).toEqual({
      dateFrom: "2026-07-13",
      dateTo: "2026-07-19",
    });
    expect(initialCalendarVisibleRange("dayGridMonth", "2026-07-17")).toEqual({
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
    });
  });

  it("uses Monday through Sunday for every weekly range", () => {
    expect(startOfWeekInput("2026-08-23")).toBe("2026-08-17");
    expect(endOfWeekInput("2026-08-23")).toBe("2026-08-23");
  });
});

describe("follow-up slot presets", () => {
  it("moves start and end together and keeps the duration", () => {
    expect(shiftAppointmentSlot({ date: "2026-10-05", timeStart: "10:00", timeEnd: "11:00" }, { days: 7 }))
      .toMatchObject({ date: "2026-10-12", timeStart: "10:00", timeEnd: "11:00" });
    expect(shiftAppointmentSlot({ date: "2026-10-05", timeStart: "10:00:00", timeEnd: "11:30:00" }, { months: 6 }))
      .toMatchObject({ date: "2027-04-05", timeStart: "10:00", timeEnd: "11:30" });
  });

  it("leaves the end empty when the source has none", () => {
    expect(shiftAppointmentSlot({ date: "2026-10-05", timeStart: "10:00", timeEnd: null }, { months: 1 }))
      .toMatchObject({ date: "2026-11-05", timeStart: "10:00", timeEnd: "" });
  });
});
