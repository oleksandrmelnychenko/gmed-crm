import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";

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
      width: 96,
    });
  });

  it("offers no signature for a document that cannot be signed (QA B-16)", () => {
    type Row = { id: string; archived: boolean };
    const column = createDocumentPreviewColumn<Row>({
      getId: (row) => row.id,
      getTitle: (row) => row.id,
      label: "Preview",
      onPreview: vi.fn(),
      canSign: (row) => !row.archived,
    });
    const offersSignature = (row: Row) => {
      const cell = column.render?.(row) as ReactElement<{ children: unknown[] }>;
      return cell.props.children.some(
        (child) => isValidElement(child) && child.type === DocumentSignatureAction,
      );
    };

    expect(offersSignature({ id: "active", archived: false })).toBe(true);
    expect(offersSignature({ id: "deleted-file", archived: true })).toBe(false);
  });
});
