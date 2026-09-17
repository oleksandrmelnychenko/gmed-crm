import { describe, expect, it } from "vitest";

import { DEFAULT_IDLE_LOGOUT_MINUTES, isIdleExpired, resolveIdleLogoutMinutes } from "./idle-logout";

describe("idle logout", () => {
  it("expires once the limit has passed without activity", () => {
    const start = 1_000_000;
    expect(isIdleExpired(start, start + 29 * 60_000, 30)).toBe(false);
    expect(isIdleExpired(start, start + 30 * 60_000, 30)).toBe(true);
  });

  it("never expires when switched off or without a stamp", () => {
    expect(isIdleExpired(0, Number.MAX_SAFE_INTEGER, 0)).toBe(false);
    expect(isIdleExpired(null, Number.MAX_SAFE_INTEGER, 30)).toBe(false);
  });

  it("falls back to the default for missing or invalid configuration", () => {
    expect(resolveIdleLogoutMinutes(undefined)).toBe(DEFAULT_IDLE_LOGOUT_MINUTES);
    expect(resolveIdleLogoutMinutes("abc")).toBe(DEFAULT_IDLE_LOGOUT_MINUTES);
    expect(resolveIdleLogoutMinutes("-5")).toBe(DEFAULT_IDLE_LOGOUT_MINUTES);
    expect(resolveIdleLogoutMinutes("0")).toBe(0);
    expect(resolveIdleLogoutMinutes("15")).toBe(15);
  });
});
