import { describe, expect, it } from "vitest";

import {
  buildCompanyFinancialPositionPath,
  buildCompanyProviderStatementPath,
} from "./data";

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

  it("builds a period and currency scoped provider statement path", () => {
    expect(buildCompanyProviderStatementPath("provider-42", {
      from: "2026-03-01",
      to: "2026-03-31",
      currency: "EUR",
    })).toBe(
      "/company-provider-statements/provider-42?from=2026-03-01&to=2026-03-31&currency=EUR",
    );
  });
});
