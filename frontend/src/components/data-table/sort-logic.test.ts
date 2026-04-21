import { describe, expect, it } from "vitest";

import { MAX_SORT_STACK, applySort, compareRows, toggleSort } from "./sort-logic";
import type { SortKey, SortStack } from "./types";

type Row = {
  id: string;
  name: string;
  age: number | null;
  active: boolean;
  created: string | null;
};

const rows: Row[] = [
  { id: "a", name: "Bob", age: 30, active: true, created: "2026-04-01" },
  { id: "b", name: "Anna", age: 45, active: false, created: "2026-04-02" },
  { id: "c", name: "Anna", age: 25, active: true, created: null },
  { id: "d", name: "Zoe", age: null, active: false, created: "2026-03-15" },
  { id: "e", name: "zoe", age: 10, active: true, created: "2026-04-10" },
];

const ctx = {
  accessors: {
    name: (r: Row) => r.name,
    age: (r: Row) => r.age,
    active: (r: Row) => r.active,
    created: (r: Row) => r.created,
    id: (r: Row) => r.id,
  },
};

describe("applySort — empty stack", () => {
  it("returns copy unchanged", () => {
    const result = applySort(rows, [], ctx);
    expect(result).toHaveLength(rows.length);
    expect(result).not.toBe(rows);
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("applySort — single key", () => {
  it("ascending string", () => {
    const result = applySort(rows, [{ field: "name", dir: "asc" }], ctx);
    expect(result.map((r) => r.name)).toEqual(["Anna", "Anna", "Bob", "Zoe", "zoe"]);
  });
  it("descending string", () => {
    const result = applySort(rows, [{ field: "name", dir: "desc" }], ctx);
    expect(result.map((r) => r.name)).toEqual(["Zoe", "zoe", "Bob", "Anna", "Anna"]);
  });
  it("ascending number with null pushed to end", () => {
    const result = applySort(rows, [{ field: "age", dir: "asc" }], ctx);
    expect(result.map((r) => r.age)).toEqual([10, 25, 30, 45, null]);
  });
  it("descending number also pushes null to end", () => {
    const result = applySort(rows, [{ field: "age", dir: "desc" }], ctx);
    expect(result.map((r) => r.age)).toEqual([45, 30, 25, 10, null]);
  });
  it("boolean ascending (false first)", () => {
    const result = applySort(rows, [{ field: "active", dir: "asc" }], ctx);
    const activeSeq = result.map((r) => r.active);
    expect(activeSeq.slice(0, 2)).toEqual([false, false]);
    expect(activeSeq.slice(2)).toEqual([true, true, true]);
  });
  it("date string ISO ascending", () => {
    const result = applySort(rows, [{ field: "created", dir: "asc" }], ctx);
    const created = result.map((r) => r.created);
    expect(created[created.length - 1]).toBeNull();
    expect(created.slice(0, 4)).toEqual(["2026-03-15", "2026-04-01", "2026-04-02", "2026-04-10"]);
  });
});

describe("applySort — multi-key (tie-break)", () => {
  it("secondary sort breaks ties", () => {
    const result = applySort(rows, [
      { field: "name", dir: "asc" },
      { field: "age", dir: "asc" },
    ], ctx);
    const firstTwo = result.slice(0, 2);
    expect(firstTwo.map((r) => r.name)).toEqual(["Anna", "Anna"]);
    expect(firstTwo.map((r) => r.age)).toEqual([25, 45]);
  });
  it("tertiary sort applies when first two tie", () => {
    const result = applySort(rows, [
      { field: "name", dir: "asc" },
      { field: "active", dir: "desc" },
      { field: "id", dir: "asc" },
    ], ctx);
    expect(result.slice(0, 2).map((r) => r.id)).toEqual(["c", "b"]);
  });
  it("unknown field in stack is skipped", () => {
    const result = applySort(rows, [
      { field: "nonexistent", dir: "asc" },
      { field: "age", dir: "asc" },
    ], ctx);
    expect(result.map((r) => r.age)).toEqual([10, 25, 30, 45, null]);
  });
});

describe("compareRows — stable across sorts", () => {
  it("equal on empty stack returns 0", () => {
    expect(compareRows(rows[0], rows[1], [], ctx)).toBe(0);
  });
});

describe("toggleSort", () => {
  it("single-mode: empty → asc", () => {
    const result = toggleSort([], "name");
    expect(result).toEqual([{ field: "name", dir: "asc" }]);
  });
  it("single-mode: asc → desc", () => {
    const result = toggleSort([{ field: "name", dir: "asc" }], "name");
    expect(result).toEqual([{ field: "name", dir: "desc" }]);
  });
  it("single-mode: desc → off (empty)", () => {
    const result = toggleSort([{ field: "name", dir: "desc" }], "name");
    expect(result).toEqual([]);
  });
  it("single-mode: different field replaces entire stack", () => {
    const result = toggleSort([
      { field: "name", dir: "asc" },
      { field: "age", dir: "desc" },
    ], "created");
    expect(result).toEqual([{ field: "created", dir: "asc" }]);
  });
  it("multi-mode: adds new field to stack", () => {
    const result = toggleSort([{ field: "name", dir: "asc" }], "age", { multi: true });
    expect(result).toEqual([
      { field: "name", dir: "asc" },
      { field: "age", dir: "asc" },
    ]);
  });
  it("multi-mode: cycles existing field asc → desc", () => {
    const result = toggleSort([
      { field: "name", dir: "asc" },
      { field: "age", dir: "asc" },
    ], "age", { multi: true });
    expect(result).toEqual([
      { field: "name", dir: "asc" },
      { field: "age", dir: "desc" },
    ]);
  });
  it("multi-mode: cycles desc → removes from stack", () => {
    const result = toggleSort([
      { field: "name", dir: "asc" },
      { field: "age", dir: "desc" },
    ], "age", { multi: true });
    expect(result).toEqual([{ field: "name", dir: "asc" }]);
  });
  it(`multi-mode: caps at MAX_SORT_STACK (${MAX_SORT_STACK})`, () => {
    const full: SortStack = [
      { field: "a", dir: "asc" },
      { field: "b", dir: "asc" },
      { field: "c", dir: "asc" },
    ];
    const result = toggleSort(full, "d", { multi: true });
    expect(result).toEqual(full);
  });
  it("multi-mode on empty stack seeds first entry", () => {
    const result = toggleSort([], "name", { multi: true });
    expect(result).toEqual([{ field: "name", dir: "asc" }]);
  });
});

describe("numeric-aware string compare", () => {
  it("sorts 'Patient 2' before 'Patient 10'", () => {
    const localRows = [
      { id: "a", name: "Patient 10", age: null, active: true, created: null },
      { id: "b", name: "Patient 2", age: null, active: true, created: null },
    ];
    const result = applySort(localRows, [{ field: "name", dir: "asc" }], {
      accessors: { name: (r) => (r as { name: string }).name },
    });
    expect(result.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

const _typeAssertion: SortKey = { field: "x", dir: "asc" };
void _typeAssertion;
