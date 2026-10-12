import { describe, expect, it } from "vitest";

import type { RealtimeEvent } from "@/lib/realtime";

import { skipPassiveOrderRefresh } from "./order-realtime";

const event = (type: string): RealtimeEvent => ({ type } as RealtimeEvent);

describe("order workspace realtime refresh (QA C-33)", () => {
  const loadedAt = 1_000_000;

  it("skips the socket's connected frame right after the workspace loaded", () => {
    expect(skipPassiveOrderRefresh([event("realtime.connected")], loadedAt, loadedAt + 400)).toBe(true);
  });

  it("refreshes on a connected frame long after the load", () => {
    expect(skipPassiveOrderRefresh([event("realtime.connected")], loadedAt, loadedAt + 60_000)).toBe(false);
  });

  it("always refreshes on a real change or a resync", () => {
    expect(skipPassiveOrderRefresh([event("order.updated")], loadedAt, loadedAt + 100)).toBe(false);
    expect(skipPassiveOrderRefresh([event("realtime.resync_required")], loadedAt, loadedAt + 100)).toBe(false);
    expect(
      skipPassiveOrderRefresh([event("realtime.connected"), event("order.leistung_added")], loadedAt, loadedAt + 100),
    ).toBe(false);
  });
});
