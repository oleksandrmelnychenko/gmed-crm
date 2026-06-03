import { describe, expect, it } from "vitest";

import {
  parseDensity,
  parseFilters,
  parseHiddenColumns,
  parseSort,
  readDataTableState,
  serializeFilters,
  serializeHiddenColumns,
  serializeSort,
  writeDataTableState,
} from "./url-state";
import type { FilterPredicate } from "./types";

describe("serializeFilters / parseFilters — scalar operators", () => {
  it("contains round-trip", () => {
    const f: FilterPredicate = { id: "1", field: "name", operator: "contains", value: "Müller" };
    const serialized = serializeFilters([f]);
    expect(serialized).toBe("name:contains:M%C3%BCller");
    const parsed = parseFilters(serialized);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].field).toBe("name");
    expect(parsed[0].operator).toBe("contains");
    expect(parsed[0].value).toBe("Müller");
  });
  it("is boolean round-trip", () => {
    const f: FilterPredicate = { id: "1", field: "active", operator: "is", value: true };
    const serialized = serializeFilters([f]);
    expect(serialized).toBe("active:is:true");
    const parsed = parseFilters(serialized);
    expect(parsed[0].value).toBe(true);
  });
  it("is string round-trip", () => {
    const f: FilterPredicate = { id: "1", field: "insurance", operator: "is", value: "private" };
    const serialized = serializeFilters([f]);
    expect(serialized).toBe("insurance:is:private");
    expect(parseFilters(serialized)[0].value).toBe("private");
  });
});

describe("serializeFilters / parseFilters — array operators", () => {
  it("is_any_of round-trip", () => {
    const f: FilterPredicate = { id: "1", field: "insurance", operator: "is_any_of", value: ["private", "public"] };
    const serialized = serializeFilters([f]);
    expect(serialized).toBe("insurance:is_any_of:private,public");
    const parsed = parseFilters(serialized);
    expect(parsed[0].value).toEqual(["private", "public"]);
  });
  it("has_any with encoded values", () => {
    const f: FilterPredicate = { id: "1", field: "tags", operator: "has_any", value: ["VIP, tag", "DE"] };
    const serialized = serializeFilters([f]);
    const parsed = parseFilters(serialized);
    expect(parsed[0].value).toEqual(["VIP, tag", "DE"]);
  });
});

describe("serializeFilters / parseFilters — empty operators", () => {
  it("is_empty requires no value", () => {
    const f: FilterPredicate = { id: "1", field: "email", operator: "is_empty", value: null };
    const serialized = serializeFilters([f]);
    expect(serialized).toBe("email:is_empty");
    const parsed = parseFilters(serialized);
    expect(parsed[0].operator).toBe("is_empty");
    expect(parsed[0].value).toBeNull();
  });
});

describe("serializeFilters / parseFilters — date operators", () => {
  it("between round-trip", () => {
    const f: FilterPredicate = { id: "1", field: "birth", operator: "between", value: { from: "1990-01-01", to: "1995-12-31" } };
    const serialized = serializeFilters([f]);
    expect(serialized).toBe("birth:between:1990-01-01~1995-12-31");
    const parsed = parseFilters(serialized);
    expect(parsed[0].value).toEqual({ from: "1990-01-01", to: "1995-12-31" });
  });
  it("between with only from", () => {
    const f: FilterPredicate = { id: "1", field: "birth", operator: "between", value: { from: "1990-01-01" } };
    const parsed = parseFilters(serializeFilters([f]));
    expect(parsed[0].value).toEqual({ from: "1990-01-01", to: undefined });
  });
  it("last_n_days round-trip", () => {
    const f: FilterPredicate = { id: "1", field: "created", operator: "last_n_days", value: { days: 7 } };
    const serialized = serializeFilters([f]);
    expect(serialized).toBe("created:last_n_days:7");
    const parsed = parseFilters(serialized);
    expect(parsed[0].value).toEqual({ days: 7 });
  });
});

describe("parseFilters — invalid inputs", () => {
  it("unknown operator is dropped", () => {
    expect(parseFilters("name:foo:bar")).toEqual([]);
  });
  it("missing field is dropped", () => {
    expect(parseFilters(":is:private")).toEqual([]);
  });
  it("scalar operator without value is kept as an editable no-op", () => {
    expect(parseFilters("name:contains")).toEqual([
      {
        id: "name:contains:0",
        field: "name",
        operator: "contains",
        value: "",
      },
    ]);
  });
  it("empty input returns []", () => {
    expect(parseFilters("")).toEqual([]);
    expect(parseFilters(null)).toEqual([]);
    expect(parseFilters(undefined)).toEqual([]);
  });
});

describe("parseFilters — multiple predicates", () => {
  it("parses several filters separated by ;", () => {
    const raw = "name:contains:M%C3%BCller;insurance:is_any_of:private,public;active:is:true";
    const parsed = parseFilters(raw);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({ field: "name", operator: "contains", value: "Müller" });
    expect(parsed[1]).toMatchObject({ field: "insurance", operator: "is_any_of", value: ["private", "public"] });
    expect(parsed[2]).toMatchObject({ field: "active", operator: "is", value: true });
  });
});

describe("serializeSort / parseSort", () => {
  it("single sort round-trip", () => {
    expect(serializeSort([{ field: "name", dir: "asc" }])).toBe("name:asc");
    expect(parseSort("name:asc")).toEqual([{ field: "name", dir: "asc" }]);
  });
  it("multi-sort round-trip", () => {
    const stack = [{ field: "name", dir: "asc" as const }, { field: "created", dir: "desc" as const }];
    const raw = serializeSort(stack);
    expect(raw).toBe("name:asc,created:desc");
    expect(parseSort(raw)).toEqual(stack);
  });
  it("invalid dir is dropped", () => {
    expect(parseSort("name:invalid,created:desc")).toEqual([{ field: "created", dir: "desc" }]);
  });
  it("empty returns []", () => {
    expect(parseSort("")).toEqual([]);
    expect(parseSort(null)).toEqual([]);
  });
});

describe("parseDensity", () => {
  it("valid density", () => {
    expect(parseDensity("compact")).toBe("compact");
    expect(parseDensity("comfortable")).toBe("comfortable");
    expect(parseDensity("condensed")).toBe("condensed");
  });
  it("invalid density returns null", () => {
    expect(parseDensity("loose")).toBeNull();
    expect(parseDensity(null)).toBeNull();
  });
});

describe("serializeHiddenColumns / parseHiddenColumns", () => {
  it("round-trip", () => {
    expect(serializeHiddenColumns(["email", "phone"])).toBe("email,phone");
    expect(parseHiddenColumns("email,phone")).toEqual(["email", "phone"]);
  });
  it("filters empty entries", () => {
    expect(parseHiddenColumns(",email,")).toEqual(["email"]);
  });
});

describe("writeDataTableState / readDataTableState", () => {
  it("writes full state to URLSearchParams", () => {
    const params = new URLSearchParams();
    const written = writeDataTableState(params, {
      filters: [{ id: "1", field: "insurance", operator: "is", value: "private" }],
      sort: [{ field: "created", dir: "desc" }],
      search: "Müller",
      density: "compact",
      hiddenColumns: ["email"],
    });
    expect(written.get("filters")).toBe("insurance:is:private");
    expect(written.get("sort")).toBe("created:desc");
    expect(written.get("q")).toBe("Müller");
    expect(written.get("density")).toBe("compact");
    expect(written.get("hide")).toBe("email");
  });
  it("preserves unrelated params", () => {
    const params = new URLSearchParams("patient=abc&page=2");
    const written = writeDataTableState(params, { search: "x" });
    expect(written.get("patient")).toBe("abc");
    expect(written.get("page")).toBe("2");
    expect(written.get("q")).toBe("x");
  });
  it("clears empty filter list from URL", () => {
    const params = new URLSearchParams("filters=name:contains:foo");
    const written = writeDataTableState(params, { filters: [] });
    expect(written.has("filters")).toBe(false);
  });
  it("clears empty search from URL", () => {
    const params = new URLSearchParams("q=something");
    const written = writeDataTableState(params, { search: "   " });
    expect(written.has("q")).toBe(false);
  });
  it("reads back state from URLSearchParams", () => {
    const params = new URLSearchParams(
      "filters=insurance:is:private;active:is:true&sort=name:asc,created:desc&q=Mueller&density=compact&hide=email,phone",
    );
    const state = readDataTableState(params);
    expect(state.filters).toHaveLength(2);
    expect(state.sort).toEqual([{ field: "name", dir: "asc" }, { field: "created", dir: "desc" }]);
    expect(state.search).toBe("Mueller");
    expect(state.density).toBe("compact");
    expect(state.hiddenColumns).toEqual(["email", "phone"]);
  });
  it("omits fields not present in URL", () => {
    const params = new URLSearchParams("q=hello");
    const state = readDataTableState(params);
    expect(state.search).toBe("hello");
    expect(state.filters).toBeUndefined();
    expect(state.sort).toBeUndefined();
    expect(state.density).toBeUndefined();
    expect(state.hiddenColumns).toBeUndefined();
  });
});
