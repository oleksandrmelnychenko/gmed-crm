import { describe, expect, it } from "vitest";

import { buildCompanyFinancialPositionPath } from "./data";

describe("company financial position filters", () => {
  it("serializes currency, period, movement and trimmed search", () => {
    expect(buildCompanyFinancialPositionPath({
      from: "2026-01-01",
      to: "2026-12-31",
      currency: "EUR",
      movement: "outflow",
      search: "  invoice 42  ",
    })).toBe(
      "/company-financial-position?from=2026-01-01&to=2026-12-31&currency=EUR&movement=outflow&search=invoice+42",
    );
  });

  it("omits optional all-movement and empty search filters", () => {
    expect(buildCompanyFinancialPositionPath({
      from: "2026-01-01",
      to: "2026-08-19",
      currency: "",
      movement: "all",
      search: "",
    })).toBe("/company-financial-position?from=2026-01-01&to=2026-08-19");
  });
});
