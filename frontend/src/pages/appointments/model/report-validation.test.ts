import { describe, expect, it } from "vitest";

import { parseValidInterpreterReportHours } from "./report-validation";

describe("parseValidInterpreterReportHours", () => {
  it("accepts quarter-hour increments from 0.25 through 24", () => {
    expect(parseValidInterpreterReportHours("0.25")).toBe(0.25);
    expect(parseValidInterpreterReportHours("2.5")).toBe(2.5);
    expect(parseValidInterpreterReportHours("24")).toBe(24);
  });

  it("rejects values outside the range or between quarter-hour increments", () => {
    expect(parseValidInterpreterReportHours("")).toBeNull();
    expect(parseValidInterpreterReportHours("0.24")).toBeNull();
    expect(parseValidInterpreterReportHours("2.6")).toBeNull();
    expect(parseValidInterpreterReportHours("24.25")).toBeNull();
  });
});
