import { afterEach, describe, expect, it, vi } from "vitest";

import {
  futureCompletionTargets,
  isAppointmentCompletionTooEarly,
  isInterpreterReportTooEarly,
} from "./completion-rules";

describe("isAppointmentCompletionTooEarly", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks completion before the appointment date and allows it from that day", () => {
    const today = "2026-09-25";

    expect(isAppointmentCompletionTooEarly("2026-10-05", today)).toBe(true);
    expect(isAppointmentCompletionTooEarly("2026-09-26", today)).toBe(true);
    expect(isAppointmentCompletionTooEarly("2026-09-25", today)).toBe(false);
    expect(isAppointmentCompletionTooEarly("2026-09-24", today)).toBe(false);
  });

  it("ignores missing or malformed dates instead of blocking", () => {
    expect(isAppointmentCompletionTooEarly(null, "2026-09-25")).toBe(false);
    expect(isAppointmentCompletionTooEarly("", "2026-09-25")).toBe(false);
    expect(isAppointmentCompletionTooEarly("2026-10", "2026-09-25")).toBe(false);
  });

  it("uses the Berlin calendar day by default", () => {
    vi.useFakeTimers();
    // 23:30 UTC on 24 Sep is already 25 Sep in Berlin (UTC+2).
    vi.setSystemTime(new Date("2026-09-24T23:30:00Z"));

    expect(isAppointmentCompletionTooEarly("2026-09-25")).toBe(false);
    expect(isAppointmentCompletionTooEarly("2026-09-26")).toBe(true);
  });
});

describe("isInterpreterReportTooEarly", () => {
  it("keeps report submit and approval closed until the appointment date", () => {
    const today = "2026-09-25";

    expect(isInterpreterReportTooEarly("2026-10-05", today)).toBe(true);
    expect(isInterpreterReportTooEarly("2026-09-25", today)).toBe(false);
    expect(isInterpreterReportTooEarly("2026-09-01", today)).toBe(false);
  });
});

describe("futureCompletionTargets", () => {
  it("returns only open targets dated after today", () => {
    const targets = [
      { id: "past", date: "2026-09-18", status: "confirmed" },
      { id: "today", date: "2026-09-25", status: "planned" },
      { id: "future", date: "2026-10-02", status: "planned" },
      { id: "future-cancelled", date: "2026-10-09", status: "cancelled" },
      { id: "future-completed", date: "2026-10-16", status: "completed" },
    ];

    expect(
      futureCompletionTargets(targets, "2026-09-25").map((item) => item.id),
    ).toEqual(["future"]);
  });
});
