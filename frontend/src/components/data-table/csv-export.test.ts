import { describe, expect, it } from "vitest";

import { buildCsv } from "./csv-export";
import type { ColumnDef } from "./types";

type Row = { id: string; name: string; email: string | null; tags: string[] };

const columns: ColumnDef<Row>[] = [
  { id: "id", label: "ID", accessor: (r) => r.id },
  { id: "name", label: "Name", accessor: (r) => r.name },
  { id: "email", label: "Email", accessor: (r) => r.email },
  { id: "tags", label: "Tags", accessor: (r) => r.tags },
];

describe("buildCsv", () => {
  it("emits header + rows", () => {
    const rows: Row[] = [
      { id: "1", name: "Alice", email: "a@x.com", tags: ["x", "y"] },
    ];
    const out = buildCsv(rows, columns);
    expect(out).toBe(`ID,Name,Email,Tags\n1,Alice,a@x.com,"x, y"`);
  });
  it("header only when no rows", () => {
    expect(buildCsv([], columns)).toBe("ID,Name,Email,Tags");
  });
  it("quotes cells containing commas, quotes, or newlines", () => {
    const rows: Row[] = [
      { id: "1", name: 'He said "hi"', email: "a,b@x.com", tags: ["multi\nline"] },
    ];
    const out = buildCsv(rows, columns);
    expect(out).toContain('"He said ""hi"""');
    expect(out).toContain('"a,b@x.com"');
    expect(out).toContain('"multi\nline"');
  });
  it("empty / null cells render as empty", () => {
    const rows: Row[] = [
      { id: "1", name: "X", email: null, tags: [] },
    ];
    const out = buildCsv(rows, columns);
    expect(out).toBe("ID,Name,Email,Tags\n1,X,,");
  });
});
