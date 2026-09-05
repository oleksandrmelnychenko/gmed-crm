import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";

import type { ColumnDef } from "./types";

type DocumentPreviewColumnOptions<T> = {
  getId: (row: T) => string;
  getTitle: (row: T) => string;
  label: string;
  onPreview: (row: T) => void;
  onSigned?: () => void;
};

export function createDocumentPreviewColumn<T>({
  getId,
  getTitle,
  label,
  onPreview,
  onSigned,
}: DocumentPreviewColumnOptions<T>): ColumnDef<T> {
  return {
    id: "preview",
    label,
    accessor: () => "",
    sortable: false,
    required: true,
    pinned: "left",
    width: 96,
    cellClassName: "flex items-center justify-center gap-1",
    render: (row) => {
      const title = getTitle(row) || label;

      return (
        <>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={label}
          aria-label={`${label}: ${title}`}
          onClick={(event) => {
            event.stopPropagation();
            onPreview(row);
          }}
          data-document-preview-id={getId(row)}
        >
          <Eye className="size-4" />
        </Button>
        <DocumentSignatureAction documentId={getId(row)} title={title} iconOnly onDone={onSigned} />
        </>
      );
    },
  };
}
