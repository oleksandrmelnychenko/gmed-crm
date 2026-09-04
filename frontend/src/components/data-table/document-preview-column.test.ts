import { describe, expect, it, vi } from "vitest";

import { createDocumentPreviewColumn } from "./document-preview-column";

describe("createDocumentPreviewColumn", () => {
  it("creates the compact pinned first-column definition used by document grids", () => {
    const column = createDocumentPreviewColumn({
      getId: (row: { id: string }) => row.id,
      getTitle: (row) => row.id,
      label: "Preview",
      onPreview: vi.fn(),
    });

    expect(column).toMatchObject({
      id: "preview",
      label: "Preview",
      pinned: "left",
      required: true,
      sortable: false,
      width: 64,
    });
  });
});
