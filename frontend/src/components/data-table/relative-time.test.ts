import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./relative-time";

describe("formatRelativeTime", () => {
  const now = new Date("2026-04-21T12:00:00Z");

  it("future → just now", () => {
    const future = new Date("2026-04-21T12:01:00Z");
    expect(formatRelativeTime(future, now)).toBe("только что");
  });
  it("under 45s → just now", () => {
    expect(formatRelativeTime(new Date("2026-04-21T11:59:30Z"), now)).toBe("только что");
  });
  it("Nm ago for minutes < 60", () => {
    expect(formatRelativeTime(new Date("2026-04-21T11:55:00Z"), now)).toBe("5 мин назад");
    expect(formatRelativeTime(new Date("2026-04-21T11:01:00Z"), now)).toBe("59 мин назад");
  });
  it("Nh ago for hours < 24", () => {
    expect(formatRelativeTime(new Date("2026-04-21T09:00:00Z"), now)).toBe("3 ч назад");
    expect(formatRelativeTime(new Date("2026-04-20T13:00:00Z"), now)).toBe("23 ч назад");
  });
  it("Nd ago for days < 7", () => {
    expect(formatRelativeTime(new Date("2026-04-18T12:00:00Z"), now)).toBe("3 дн назад");
  });
  it("falls back to localeDateString beyond 7d", () => {
    const long = new Date("2026-01-01T00:00:00Z");
    const out = formatRelativeTime(long, now);
    expect(out).not.toMatch(/ago/);
  });
});
