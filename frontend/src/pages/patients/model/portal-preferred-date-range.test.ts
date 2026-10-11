import { describe, expect, it } from "vitest";

import { portalPreferredDateRange } from "./portal-shared";

describe("portalPreferredDateRange", () => {
  it("shows both preferred dates as one DD.MM.YYYY range", () => {
    expect(portalPreferredDateRange("2026-10-26", "2026-10-31")).toEqual({
      kind: "period",
      value: "26.10.2026 – 31.10.2026",
    });
  });

  it("shows a single day once", () => {
    expect(portalPreferredDateRange("2026-10-26", "2026-10-26")).toEqual({
      kind: "period",
      value: "26.10.2026",
    });
  });

  it("keeps the open end's own label", () => {
    expect(portalPreferredDateRange("2026-10-26", null)).toEqual({
      kind: "from",
      value: "26.10.2026",
    });
    expect(portalPreferredDateRange(null, "2026-10-31")).toEqual({
      kind: "to",
      value: "31.10.2026",
    });
  });

  it("leaves the value empty without dates", () => {
    expect(portalPreferredDateRange(null, null)).toEqual({ kind: "from", value: "" });
  });
});
