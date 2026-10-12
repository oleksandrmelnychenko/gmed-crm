import { describe, expect, it } from "vitest";

import { createSharedLeadCounter, getNewLeadCount, LEAD_COUNT_FRESH_MS, LEAD_COUNT_JOIN_MS } from "./use-nav-counters";

// QA C-33: the top bar and the nav panel asked for the same count each.
describe("shared new-lead count", () => {
  function setup() {
    let clock = 1_000;
    const pending: Array<(value: unknown) => void> = [];
    let loads = 0;
    const counter = createSharedLeadCounter(
      () => {
        loads += 1;
        return new Promise((resolve) => pending.push(resolve as (value: unknown) => void));
      },
      () => clock,
    );
    const seen: number[][] = [[], []];
    counter.subscribe((count) => seen[0].push(count));
    counter.subscribe((count) => seen[1].push(count));
    const settle = async (count: number) => {
      pending.shift()?.([{ status: "new", count }]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { counter, seen, settle, loads: () => loads, tick: (ms: number) => { clock += ms; } };
  }

  it("reads once for badges that mount and refocus together", async () => {
    const { counter, seen, settle, loads, tick } = setup();
    counter.refresh("passive");
    counter.refresh("passive");
    expect(loads()).toBe(1);
    await settle(4);
    expect(seen).toEqual([[4], [4]]);
    tick(LEAD_COUNT_FRESH_MS - 1);
    counter.refresh("passive");
    expect(loads()).toBe(1);
    expect(seen).toEqual([[4, 4], [4, 4]]);
    tick(2);
    counter.refresh("passive");
    expect(loads()).toBe(2);
  });

  it("reads again after a lead change heard while an older read runs", async () => {
    const { counter, settle, loads, tick } = setup();
    counter.refresh("passive");
    counter.refresh("change");
    expect(loads()).toBe(1);
    tick(LEAD_COUNT_JOIN_MS + 1);
    counter.refresh("change");
    counter.refresh("change");
    await settle(1);
    expect(loads()).toBe(2);
    await settle(2);
    expect(loads()).toBe(2);
  });
});

describe("navigation lead counter", () => {
  it("reads the array returned by the leads-by-status endpoint", () => {
    expect(
      getNewLeadCount([
        { status: "in_progress", count: 8 },
        { status: "new", count: 3 },
      ]),
    ).toBe(3);
  });

  it("keeps compatibility with a wrapped response", () => {
    expect(
      getNewLeadCount({ data: [{ status: "new", count: 2 }] }),
    ).toBe(2);
  });

  it("returns zero when there are no new leads", () => {
    expect(getNewLeadCount([{ status: "converted", count: 4 }])).toBe(0);
  });
});
