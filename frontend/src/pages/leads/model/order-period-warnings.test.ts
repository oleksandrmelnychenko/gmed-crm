import { describe, expect, it } from "vitest";

import { orderPeriodWarnings } from "./order-period-warnings";

const today = "2026-09-24";

describe("orderPeriodWarnings", () => {
  it("is silent for a future period", () => {
    expect(orderPeriodWarnings("2026-10-01", "2026-10-05", today)).toEqual([]);
  });

  it("is silent without dates", () => {
    expect(orderPeriodWarnings("", "", today)).toEqual([]);
  });

  it("flags a period that is already over", () => {
    const warnings = orderPeriodWarnings("2026-09-16", "2026-09-18", today);
    expect(warnings.map((item) => item.key)).toEqual(["past"]);
    expect(warnings[0].ru).toContain("16.09.2026 – 18.09.2026");
  });

  it("flags a period that has started but not ended", () => {
    expect(orderPeriodWarnings("2026-09-22", "2026-09-30", today).map((item) => item.key)).toEqual(["started"]);
  });

  it("does not treat today as the past", () => {
    expect(orderPeriodWarnings(today, today, today)).toEqual([]);
  });
});
