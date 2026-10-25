import { describe, expect, it } from "vitest";

import { createNewestLoadGuard } from "./newest-load-guard";

describe("createNewestLoadGuard", () => {
  it("drops an older answer that lands after a newer one was written", () => {
    const guard = createNewestLoadGuard();
    const beforeConfirm = guard.begin();
    const afterConfirm = guard.begin();
    expect(guard.claim(afterConfirm)).toBe(true);
    expect(guard.claim(beforeConfirm)).toBe(false);
  });

  it("writes an older answer that lands first, then the newer one", () => {
    const guard = createNewestLoadGuard();
    const older = guard.begin();
    const newer = guard.begin();
    expect(guard.claim(older)).toBe(true);
    expect(guard.claim(newer)).toBe(true);
    expect(guard.claim(older)).toBe(false);
  });

  it("keeps the last written answer when a newer load never answers", () => {
    const guard = createNewestLoadGuard();
    const first = guard.begin();
    guard.begin();
    expect(guard.claim(first)).toBe(true);
    const third = guard.begin();
    expect(guard.claim(third)).toBe(true);
  });

  it("orders loads per guard", () => {
    const lead = createNewestLoadGuard();
    const other = createNewestLoadGuard();
    const leadTicket = lead.begin();
    other.claim(other.begin());
    other.claim(other.begin());
    expect(lead.claim(leadTicket)).toBe(true);
  });
});
