import { describe, expect, it } from "vitest";

import { getNewLeadCount } from "./use-nav-counters";

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
