import { describe, expect, it } from "vitest";

import { applyFilters, evaluatePredicate, type FilterContext } from "./filter-logic";
import type { FilterPredicate } from "./types";

type Row = {
  id: string;
  name: string;
  age: number | null;
  email: string | null;
  tags: string[];
  insurance: "private" | "public" | "self_pay" | null;
  insuranceProvider?: string | null;
  birth: string | null;
  created: string;
  active: boolean;
};

const rows: Row[] = [
  { id: "1", name: "Anna Müller", age: 34, email: "anna@example.com", tags: ["VIP", "DE"], insurance: "private", insuranceProvider: " Albatros ", birth: "1991-05-14", created: "2026-04-10", active: true },
  { id: "2", name: "Boris Petrov", age: 52, email: null, tags: ["RU"], insurance: "public", birth: "1973-11-02", created: "2026-04-18", active: true },
  { id: "3", name: "Clara O'Neill", age: null, email: "clara@mail.com", tags: [], insurance: null, birth: null, created: "2026-03-01", active: false },
  { id: "4", name: "Дмитро Мельник", age: 41, email: "d.melnyk@mail.com", tags: ["UA", "VIP"], insurance: "self_pay", birth: "1984-08-20", created: "2026-04-20", active: true },
];

const ctx: FilterContext<Row> = {
  accessors: {
    name: (r) => r.name,
    age: (r) => r.age,
    email: (r) => r.email,
    tags: (r) => r.tags,
    insurance: (r) => r.insurance,
    insuranceProvider: (r) => r.insuranceProvider,
    birth: (r) => r.birth,
    created: (r) => r.created,
    active: (r) => r.active,
  },
  now: new Date("2026-04-21T00:00:00Z"),
};

function pred(field: string, operator: FilterPredicate["operator"], value: FilterPredicate["value"]): FilterPredicate {
  return { id: `${field}:${operator}`, field, operator, value };
}

describe("evaluatePredicate — empties", () => {
  it("is_empty on null", () => {
    expect(evaluatePredicate(rows[1], pred("email", "is_empty", null), ctx)).toBe(true);
  });
  it("is_empty on empty string", () => {
    const r = { ...rows[0], email: "   " };
    expect(evaluatePredicate(r, pred("email", "is_empty", null), ctx)).toBe(true);
  });
  it("is_empty on empty array", () => {
    expect(evaluatePredicate(rows[2], pred("tags", "is_empty", null), ctx)).toBe(true);
  });
  it("is_not_empty on populated field", () => {
    expect(evaluatePredicate(rows[0], pred("email", "is_not_empty", null), ctx)).toBe(true);
  });
});

describe("evaluatePredicate — contains", () => {
  it("case-insensitive substring", () => {
    expect(evaluatePredicate(rows[0], pred("name", "contains", "müller"), ctx)).toBe(true);
    expect(evaluatePredicate(rows[0], pred("name", "contains", "MÜLLER"), ctx)).toBe(true);
  });
  it("does_not_contain", () => {
    expect(evaluatePredicate(rows[0], pred("name", "does_not_contain", "petrov"), ctx)).toBe(true);
    expect(evaluatePredicate(rows[1], pred("name", "does_not_contain", "petrov"), ctx)).toBe(false);
  });
  it("unicode contains", () => {
    expect(evaluatePredicate(rows[3], pred("name", "contains", "Мельник"), ctx)).toBe(true);
  });
  it("empty operand returns true (no-op)", () => {
    expect(evaluatePredicate(rows[0], pred("name", "contains", ""), ctx)).toBe(true);
  });
  it("contains on null field", () => {
    expect(evaluatePredicate(rows[2], pred("email", "contains", "any"), ctx)).toBe(false);
  });
});

describe("evaluatePredicate — is / is_not / equals", () => {
  it("is string equals", () => {
    expect(evaluatePredicate(rows[0], pred("insurance", "is", "private"), ctx)).toBe(true);
    expect(evaluatePredicate(rows[1], pred("insurance", "is", "private"), ctx)).toBe(false);
  });
  it("matches enum strings case/space-insensitively", () => {
    expect(evaluatePredicate(rows[0], pred("insuranceProvider", "is", "albatros"), ctx)).toBe(true);
    expect(evaluatePredicate(rows[0], pred("insuranceProvider", "is", "  ALBATROS  "), ctx)).toBe(true);
    expect(evaluatePredicate(rows[0], pred("insuranceProvider", "is_not", "  ALBATROS  "), ctx)).toBe(false);
  });
  it("is on null field returns false", () => {
    expect(evaluatePredicate(rows[2], pred("insurance", "is", "private"), ctx)).toBe(false);
  });
  it("is_not on null field returns true (field-is-null passes is_not-X)", () => {
    expect(evaluatePredicate(rows[2], pred("insurance", "is_not", "private"), ctx)).toBe(true);
  });
  it("is boolean", () => {
    expect(evaluatePredicate(rows[0], pred("active", "is", true), ctx)).toBe(true);
    expect(evaluatePredicate(rows[2], pred("active", "is", true), ctx)).toBe(false);
    expect(evaluatePredicate(rows[2], pred("active", "is", false), ctx)).toBe(true);
  });
  it("equals on number", () => {
    expect(evaluatePredicate(rows[0], pred("age", "equals", "34"), ctx)).toBe(true);
    expect(evaluatePredicate(rows[0], pred("age", "equals", "35"), ctx)).toBe(false);
  });
  it("equals with an empty string is a no-op for default number filters", () => {
    expect(applyFilters(rows, [pred("age", "equals", "")], ctx)).toEqual(rows);
  });
});

describe("evaluatePredicate — is_any_of / is_none_of", () => {
  it("is_any_of matches one", () => {
    expect(evaluatePredicate(rows[0], pred("insurance", "is_any_of", ["private", "public"]), ctx)).toBe(true);
    expect(evaluatePredicate(rows[3], pred("insurance", "is_any_of", ["private", "public"]), ctx)).toBe(false);
  });
  it("is_any_of matches string options case/space-insensitively", () => {
    expect(evaluatePredicate(rows[0], pred("insuranceProvider", "is_any_of", [" albatros "]), ctx)).toBe(true);
    expect(evaluatePredicate(rows[0], pred("insuranceProvider", "is_none_of", [" albatros "]), ctx)).toBe(false);
  });
  it("is_any_of empty list = no-op (keeps row)", () => {
    expect(evaluatePredicate(rows[0], pred("insurance", "is_any_of", []), ctx)).toBe(true);
  });
  it("is_none_of excludes matches", () => {
    expect(evaluatePredicate(rows[0], pred("insurance", "is_none_of", ["private"]), ctx)).toBe(false);
    expect(evaluatePredicate(rows[1], pred("insurance", "is_none_of", ["private"]), ctx)).toBe(true);
  });
  it("is_none_of on null field passes (not in list)", () => {
    expect(evaluatePredicate(rows[2], pred("insurance", "is_none_of", ["private"]), ctx)).toBe(true);
  });
});

describe("evaluatePredicate — has_any / has_all / has_none", () => {
  it("has_any matches overlap", () => {
    expect(evaluatePredicate(rows[0], pred("tags", "has_any", ["VIP"]), ctx)).toBe(true);
    expect(evaluatePredicate(rows[1], pred("tags", "has_any", ["VIP"]), ctx)).toBe(false);
  });
  it("has_any normalizes tag values", () => {
    expect(evaluatePredicate(rows[0], pred("tags", "has_any", [" vip "]), ctx)).toBe(true);
  });
  it("has_all requires all", () => {
    expect(evaluatePredicate(rows[0], pred("tags", "has_all", ["VIP", "DE"]), ctx)).toBe(true);
    expect(evaluatePredicate(rows[0], pred("tags", "has_all", ["VIP", "RU"]), ctx)).toBe(false);
  });
  it("has_none excludes any overlap", () => {
    expect(evaluatePredicate(rows[0], pred("tags", "has_none", ["RU"]), ctx)).toBe(true);
    expect(evaluatePredicate(rows[1], pred("tags", "has_none", ["RU"]), ctx)).toBe(false);
  });
  it("has_all on empty field fails", () => {
    expect(evaluatePredicate(rows[2], pred("tags", "has_all", ["VIP"]), ctx)).toBe(false);
  });
  it("empty operand list = no-op", () => {
    expect(evaluatePredicate(rows[0], pred("tags", "has_any", []), ctx)).toBe(true);
  });
});

describe("evaluatePredicate — date operators", () => {
  it("before", () => {
    expect(evaluatePredicate(rows[1], pred("birth", "before", "1980-01-01"), ctx)).toBe(true);
    expect(evaluatePredicate(rows[0], pred("birth", "before", "1980-01-01"), ctx)).toBe(false);
  });
  it("after", () => {
    expect(evaluatePredicate(rows[0], pred("birth", "after", "1980-01-01"), ctx)).toBe(true);
    expect(evaluatePredicate(rows[1], pred("birth", "after", "1980-01-01"), ctx)).toBe(false);
  });
  it("before on null field fails", () => {
    expect(evaluatePredicate(rows[2], pred("birth", "before", "2000-01-01"), ctx)).toBe(false);
  });
  it("between includes both bounds", () => {
    expect(evaluatePredicate(rows[0], pred("birth", "between", { from: "1990-01-01", to: "1995-12-31" }), ctx)).toBe(true);
    expect(evaluatePredicate(rows[1], pred("birth", "between", { from: "1990-01-01", to: "1995-12-31" }), ctx)).toBe(false);
  });
  it("between with only from", () => {
    expect(evaluatePredicate(rows[0], pred("birth", "between", { from: "1980-01-01" }), ctx)).toBe(true);
    expect(evaluatePredicate(rows[1], pred("birth", "between", { from: "1980-01-01" }), ctx)).toBe(false);
  });
  it("date filters with empty operands are no-ops", () => {
    expect(evaluatePredicate(rows[0], pred("birth", "before", ""), ctx)).toBe(true);
    expect(evaluatePredicate(rows[0], pred("birth", "after", ""), ctx)).toBe(true);
    expect(evaluatePredicate(rows[0], pred("birth", "between", {}), ctx)).toBe(true);
  });
  it("last_n_days", () => {
    expect(evaluatePredicate(rows[3], pred("created", "last_n_days", { days: 7 }), ctx)).toBe(true);
    expect(evaluatePredicate(rows[2], pred("created", "last_n_days", { days: 7 }), ctx)).toBe(false);
  });
  it("last_n_days invalid days = no-op", () => {
    expect(evaluatePredicate(rows[0], pred("created", "last_n_days", { days: 0 }), ctx)).toBe(true);
  });
});

describe("evaluatePredicate — unknown field", () => {
  it("returns true when accessor missing", () => {
    expect(evaluatePredicate(rows[0], pred("nonexistent", "is", "X"), ctx)).toBe(true);
  });
});

describe("applyFilters", () => {
  it("empty predicates returns all rows (copy)", () => {
    const result = applyFilters(rows, [], ctx);
    expect(result).toHaveLength(rows.length);
    expect(result).not.toBe(rows);
  });
  it("AND combining multiple predicates", () => {
    const result = applyFilters(rows, [
      pred("active", "is", true),
      pred("tags", "has_any", ["VIP"]),
    ], ctx);
    expect(result.map((r) => r.id)).toEqual(["1", "4"]);
  });
  it("no matches returns empty array", () => {
    const result = applyFilters(rows, [
      pred("insurance", "is", "private"),
      pred("name", "contains", "Petrov"),
    ], ctx);
    expect(result).toEqual([]);
  });
});
