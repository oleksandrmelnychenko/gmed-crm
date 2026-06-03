import { describe, expect, it } from "vitest";

import {
  applySearch,
  buildSearchIndex,
  matchesSearch,
  searchWithIndex,
  tokenize,
  type SearchContext,
} from "./search";

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  tags: string[];
  birth: string | null;
};

const rows: Row[] = [
  { id: "1", name: "Anna Müller", email: "anna@example.com", phone: "+49 170 123 4567", tags: ["VIP", "DE"], birth: "1991-05-14" },
  { id: "2", name: "Boris Petrov", email: null, phone: "+49 152 987 6543", tags: ["RU"], birth: "1973-11-02" },
  { id: "3", name: "Clara O'Neill", email: "clara.oneill@mail.com", phone: "+353 1 234 5678", tags: [], birth: null },
  { id: "4", name: "Дмитро Мельник", email: "d.melnyk@mail.com", phone: "+380 67 555 1234", tags: ["UA", "VIP"], birth: "1984-08-20" },
];

const ctx: SearchContext<Row> = {
  fields: [
    (r) => r.name,
    (r) => r.email,
    (r) => r.phone,
    (r) => r.tags,
    (r) => r.birth,
  ],
};

describe("tokenize", () => {
  it("splits by whitespace, lowercases and folds German umlauts to digraphs", () => {
    expect(tokenize("Anna Müller")).toEqual(["anna", "mueller"]);
  });
  it("collapses multiple spaces", () => {
    expect(tokenize("  foo   bar  ")).toEqual(["foo", "bar"]);
  });
  it("empty string returns []", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
  it("unicode tokens preserved", () => {
    expect(tokenize("Мельник 1985")).toEqual(["мельник", "1985"]);
  });
});

describe("matchesSearch", () => {
  it("empty tokens matches all", () => {
    expect(matchesSearch(rows[0], [], ctx)).toBe(true);
  });
  it("single token substring match across fields", () => {
    expect(matchesSearch(rows[0], ["müller"], ctx)).toBe(true);
    expect(matchesSearch(rows[0], ["anna@"], ctx)).toBe(true);
    expect(matchesSearch(rows[0], ["170"], ctx)).toBe(true);
    expect(matchesSearch(rows[0], ["vip"], ctx)).toBe(true);
  });
  it("token in tag array matches", () => {
    expect(matchesSearch(rows[3], ["ua"], ctx)).toBe(true);
  });
  it("tokenized AND — tokens can match different fields", () => {
    expect(matchesSearch(rows[0], ["anna", "vip"], ctx)).toBe(true);
    expect(matchesSearch(rows[0], ["anna", "ru"], ctx)).toBe(false);
  });
  it("all tokens must match", () => {
    expect(matchesSearch(rows[0], ["anna", "1991"], ctx)).toBe(true);
    expect(matchesSearch(rows[0], ["anna", "xyz"], ctx)).toBe(false);
  });
  it("case-insensitive", () => {
    expect(matchesSearch(rows[0], ["MÜLLER"], ctx)).toBe(true);
  });
  it("unicode query matches unicode field", () => {
    expect(matchesSearch(rows[3], ["мельник"], ctx)).toBe(true);
    expect(matchesSearch(rows[3], ["Мельник"], ctx)).toBe(true);
  });
  it("null field is skipped (no crash)", () => {
    expect(matchesSearch(rows[1], ["anna@"], ctx)).toBe(false);
    expect(matchesSearch(rows[1], ["petrov"], ctx)).toBe(true);
  });
});

describe("German umlaut / eszett folding", () => {
  it("ASCII digraph query matches stored umlaut name", () => {
    // typing "Mueller" / "mueller" must find "Anna Müller"
    expect(applySearch(rows, "Mueller", ctx).map((r) => r.id)).toEqual(["1"]);
    expect(applySearch(rows, "mueller", ctx).map((r) => r.id)).toEqual(["1"]);
  });
  it("real umlaut query still matches", () => {
    expect(applySearch(rows, "Müller", ctx).map((r) => r.id)).toEqual(["1"]);
  });
  it("matchesSearch folds a raw umlaut token", () => {
    expect(matchesSearch(rows[0], ["mueller"], ctx)).toBe(true);
    expect(matchesSearch(rows[0], ["MÜLLER"], ctx)).toBe(true);
  });
  it("Cyrillic is unaffected by German folding", () => {
    expect(applySearch(rows, "Мельник", ctx).map((r) => r.id)).toEqual(["4"]);
  });
});

describe("applySearch", () => {
  it("empty query returns all", () => {
    expect(applySearch(rows, "", ctx)).toHaveLength(rows.length);
    expect(applySearch(rows, "   ", ctx)).toHaveLength(rows.length);
  });
  it("single-token filters", () => {
    const result = applySearch(rows, "vip", ctx);
    expect(result.map((r) => r.id).sort()).toEqual(["1", "4"]);
  });
  it("multi-token AND", () => {
    const result = applySearch(rows, "müller anna", ctx);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });
  it("partial phone number matches", () => {
    const result = applySearch(rows, "170", ctx);
    expect(result.map((r) => r.id)).toEqual(["1"]);
  });
  it("no match returns []", () => {
    expect(applySearch(rows, "xyznonexistent", ctx)).toEqual([]);
  });
  it("returns a new array (not the input)", () => {
    const result = applySearch(rows, "", ctx);
    expect(result).not.toBe(rows);
  });
});

describe("buildSearchIndex / searchWithIndex", () => {
  it("index contains blob for each row", () => {
    const index = buildSearchIndex(rows, ctx);
    expect(index).toHaveLength(rows.length);
    expect(index[0].blob).toContain("anna");
    expect(index[0].blob).toContain("vip");
  });
  it("searchWithIndex produces same results as applySearch", () => {
    const index = buildSearchIndex(rows, ctx);
    const direct = applySearch(rows, "vip", ctx).map((r) => r.id);
    const indexed = searchWithIndex(index, "vip").map((r) => r.id);
    expect(indexed).toEqual(direct);
  });
  it("empty query via index returns all rows", () => {
    const index = buildSearchIndex(rows, ctx);
    expect(searchWithIndex(index, "").map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });
});
