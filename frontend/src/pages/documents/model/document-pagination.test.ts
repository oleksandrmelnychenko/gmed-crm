import { describe, expect, it } from "vitest";

import {
  DEFAULT_DOCUMENT_PAGE_SIZE,
  buildDocumentPage,
} from "./document-pagination";

describe("buildDocumentPage", () => {
  const rows = Array.from({ length: 61 }, (_, index) => index + 1);

  it("returns the requested page with a one-based visible range", () => {
    expect(buildDocumentPage(rows, 1, 25)).toEqual({
      end: 50,
      pageIndex: 1,
      rows: rows.slice(25, 50),
      start: 26,
      totalPages: 3,
    });
  });

  it("clamps a stale page after filtering reduces the row count", () => {
    expect(buildDocumentPage(rows.slice(0, 8), 4, 25)).toEqual({
      end: 8,
      pageIndex: 0,
      rows: rows.slice(0, 8),
      start: 1,
      totalPages: 1,
    });
  });

  it("uses the conservative default for an invalid page size", () => {
    expect(buildDocumentPage(rows, 0, 0).rows).toEqual(
      rows.slice(0, DEFAULT_DOCUMENT_PAGE_SIZE),
    );
  });
});
