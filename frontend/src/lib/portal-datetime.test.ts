import { describe, expect, it } from "vitest";
import { formatPortalTimestamp, formatPortalTimeWindow } from "./portal-datetime";

describe("portal dates in Berlin", () => {
  it("does not invent a clock for a calendar date or a missing value", () => {
    expect(formatPortalTimestamp("2026-04-20")).toBe("20.04.2026");
    expect(formatPortalTimestamp(null)).toBe("");
  });
  it("prints the day once when both times fall on the same Berlin day", () => {
    expect(formatPortalTimeWindow("2026-04-19T23:30:00Z", "2026-04-20T01:30:00Z")).toBe("20.04.2026 · 01:30–03:30");
  });
  it("shows both days when crossing Berlin midnight", () => {
    expect(formatPortalTimeWindow("2026-04-20T21:30:00Z", "2026-04-20T22:30:00Z")).toBe("20.04.2026 · 23:30 – 21.04.2026 · 00:30");
  });
  it("handles open windows and date-only endpoints", () => {
    expect(formatPortalTimeWindow(null, "2026-04-20T06:00:00Z")).toBe("20.04.2026 · 08:00");
    expect(formatPortalTimeWindow("2026-04-20", null)).toBe("20.04.2026");
    expect(formatPortalTimeWindow("2026-04-20", "2026-04-20")).toBe("20.04.2026");
  });
});
