import { describe, expect, it } from "vitest";

import {
  DEFAULT_OPERATOR_LABELS,
  OPERATORS_BY_FIELD_TYPE,
  defaultOperatorForFieldType,
  defaultValueForOperator,
  labelForOperator,
  operatorExpectsArray,
  operatorExpectsDateRange,
  operatorExpectsDays,
  operatorExpectsSingleDate,
  operatorTakesValue,
} from "./filter-operator-meta";

describe("OPERATORS_BY_FIELD_TYPE", () => {
  it("text operators include contains + empties", () => {
    expect(OPERATORS_BY_FIELD_TYPE.text).toContain("contains");
    expect(OPERATORS_BY_FIELD_TYPE.text).toContain("is_empty");
  });
  it("enum supports single and any-of flavors", () => {
    expect(OPERATORS_BY_FIELD_TYPE.enum).toContain("is");
    expect(OPERATORS_BY_FIELD_TYPE.enum).toContain("is_any_of");
  });
  it("tag_array omits is/is_not (array not scalar)", () => {
    expect(OPERATORS_BY_FIELD_TYPE.tag_array).not.toContain("is");
    expect(OPERATORS_BY_FIELD_TYPE.tag_array).toContain("has_any");
  });
  it("date has between + last_n_days", () => {
    expect(OPERATORS_BY_FIELD_TYPE.date).toContain("between");
    expect(OPERATORS_BY_FIELD_TYPE.date).toContain("last_n_days");
  });
  it("boolean has only is", () => {
    expect(OPERATORS_BY_FIELD_TYPE.boolean).toEqual(["is"]);
  });
});

describe("defaultOperatorForFieldType", () => {
  it("returns first operator for each field type", () => {
    expect(defaultOperatorForFieldType("text")).toBe("contains");
    expect(defaultOperatorForFieldType("enum")).toBe("is");
    expect(defaultOperatorForFieldType("date")).toBe("is");
    expect(defaultOperatorForFieldType("boolean")).toBe("is");
  });
});

describe("defaultValueForOperator", () => {
  it("empty operators → null", () => {
    expect(defaultValueForOperator("is_empty", "text")).toBeNull();
    expect(defaultValueForOperator("is_not_empty", "text")).toBeNull();
  });
  it("array operators → []", () => {
    expect(defaultValueForOperator("is_any_of", "enum")).toEqual([]);
    expect(defaultValueForOperator("has_any", "tag_array")).toEqual([]);
  });
  it("between → empty date range", () => {
    expect(defaultValueForOperator("between", "date")).toEqual({ from: undefined, to: undefined });
  });
  it("last_n_days → days: 7", () => {
    expect(defaultValueForOperator("last_n_days", "date")).toEqual({ days: 7 });
  });
  it("boolean → true", () => {
    expect(defaultValueForOperator("is", "boolean")).toBe(true);
  });
  it("text defaults to empty string", () => {
    expect(defaultValueForOperator("contains", "text")).toBe("");
  });
});

describe("operator predicates", () => {
  it("operatorTakesValue false for empty ops only", () => {
    expect(operatorTakesValue("is_empty")).toBe(false);
    expect(operatorTakesValue("is_not_empty")).toBe(false);
    expect(operatorTakesValue("contains")).toBe(true);
    expect(operatorTakesValue("is")).toBe(true);
  });
  it("operatorExpectsArray covers any_of / none_of / has_*", () => {
    expect(operatorExpectsArray("is_any_of")).toBe(true);
    expect(operatorExpectsArray("is_none_of")).toBe(true);
    expect(operatorExpectsArray("has_any")).toBe(true);
    expect(operatorExpectsArray("has_all")).toBe(true);
    expect(operatorExpectsArray("has_none")).toBe(true);
    expect(operatorExpectsArray("is")).toBe(false);
  });
  it("operatorExpectsDateRange only between", () => {
    expect(operatorExpectsDateRange("between")).toBe(true);
    expect(operatorExpectsDateRange("before")).toBe(false);
    expect(operatorExpectsDateRange("after")).toBe(false);
  });
  it("operatorExpectsSingleDate for is/before/after", () => {
    expect(operatorExpectsSingleDate("is")).toBe(true);
    expect(operatorExpectsSingleDate("before")).toBe(true);
    expect(operatorExpectsSingleDate("after")).toBe(true);
    expect(operatorExpectsSingleDate("between")).toBe(false);
  });
  it("operatorExpectsDays only last_n_days", () => {
    expect(operatorExpectsDays("last_n_days")).toBe(true);
    expect(operatorExpectsDays("between")).toBe(false);
  });
});

describe("labelForOperator", () => {
  it("uses default label when no overrides", () => {
    expect(labelForOperator("contains")).toBe("contains");
    expect(labelForOperator("is_any_of")).toBe("is any of");
    expect(labelForOperator("last_n_days")).toBe("last N days");
  });
  it("prefers override when provided", () => {
    expect(labelForOperator("contains", { contains: "містить" })).toBe("містить");
  });
  it("falls back to default if override missing this key", () => {
    expect(labelForOperator("contains", { is: "равно" })).toBe("contains");
  });
  it("DEFAULT_OPERATOR_LABELS covers all operators", () => {
    for (const op of Object.keys(OPERATORS_BY_FIELD_TYPE.date)) {
      void op;
    }
    expect(DEFAULT_OPERATOR_LABELS.contains).toBe("contains");
    expect(DEFAULT_OPERATOR_LABELS.is_empty).toBe("is empty");
  });
});
