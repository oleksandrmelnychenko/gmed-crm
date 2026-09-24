import { describe, expect, it } from "vitest";

import { orderPeriodWarnings } from "./order-period-warnings";

const today = "2026-09-24";
const contract = { contract_number: "FC-20260920-0033", valid_from: "2026-09-20" };

describe("orderPeriodWarnings", () => {
  it("is silent for a future period inside the contract", () => {
    expect(orderPeriodWarnings("2026-10-01", "2026-10-05", contract, today)).toEqual([]);
  });

  it("is silent without dates", () => {
    expect(orderPeriodWarnings("", "", contract, today)).toEqual([]);
  });

  it("flags a period that is already over and starts before the contract", () => {
    const warnings = orderPeriodWarnings("2026-09-16", "2026-09-18", contract, today);
    expect(warnings.map((item) => item.key)).toEqual(["past", "before_contract"]);
    expect(warnings[0].ru).toContain("16.09.2026 – 18.09.2026");
    expect(warnings[1].ru).toContain("FC-20260920-0033 (с 20.09.2026)");
  });

  it("flags a period that has started but not ended", () => {
    expect(orderPeriodWarnings("2026-09-22", "2026-09-30", contract, today).map((item) => item.key)).toEqual(["started"]);
  });

  it("does not treat today as the past", () => {
    expect(orderPeriodWarnings(today, today, contract, today)).toEqual([]);
  });
});
