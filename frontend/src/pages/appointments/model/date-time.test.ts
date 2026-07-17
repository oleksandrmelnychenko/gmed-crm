import { describe, expect, it } from "vitest";

import {
  currentDateInput,
  normalizeAppointmentTimePair,
  serializeAppointmentTimes,
  inclusiveCalendarVisibleRange,
  initialCalendarVisibleRange,
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
});
