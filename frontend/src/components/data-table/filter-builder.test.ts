import { describe, expect, it } from "vitest";

import { filterColumnGroupLabel, valueSummary } from "./filter-builder";
import { valueForOperatorChange } from "./filter-operator-meta";

describe("date filters (QA 2026-10-31, S2-2)", () => {
  const predicate = (operator: "is" | "between", value: string | { from?: string; to?: string }) =>
    ({ id: "1", field: "created", operator, value });

  it("shows the day as DD.MM.YYYY on the chip", () => {
    expect(valueSummary(predicate("is", "2026-10-30"), [], undefined, "date")).toBe("30.10.2026");
    expect(valueSummary(predicate("between", { from: "2026-10-01", to: "2026-10-30" }), [], undefined, "date"))
      .toBe("01.10.2026 → 30.10.2026");
    expect(valueSummary(predicate("is", "2026-10-30"), [], undefined, "text")).toBe("2026-10-30");
  });

  it("keeps the chosen day when the operator changes", () => {
    expect(valueForOperatorChange("before", "2026-10-30", "date")).toBe("2026-10-30");
    expect(valueForOperatorChange("between", "2026-10-30", "date")).toEqual({ from: "2026-10-30", to: undefined });
    expect(valueForOperatorChange("is", { from: "2026-10-30" }, "date")).toBe("2026-10-30");
    expect(valueForOperatorChange("last_n_days", "2026-10-30", "date")).toEqual({ days: 7 });
    expect(valueForOperatorChange("contains", "abc", "text")).toBe("");
  });
});

describe("filterColumnGroupLabel", () => {
  const groups = { identity: "Идентификация", audit: "Аудит" };

  it("names a column group in the UI language", () => {
    expect(filterColumnGroupLabel("identity", groups)).toBe("Идентификация");
    expect(filterColumnGroupLabel("audit", groups)).toBe("Аудит");
  });

  it("never prints a raw group key", () => {
    expect(filterColumnGroupLabel("metadata", groups)).toBeNull();
    expect(filterColumnGroupLabel("insurance")).toBeNull();
    expect(filterColumnGroupLabel("identity", { identity: "  " })).toBeNull();
    expect(filterColumnGroupLabel(undefined, groups)).toBeNull();
  });

  it("keeps a group that already carries its translated name", () => {
    expect(filterColumnGroupLabel("Kontakt")).toBe("Kontakt");
    expect(filterColumnGroupLabel("Контакты")).toBe("Контакты");
  });
});
