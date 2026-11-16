import { cn } from "@/lib/utils";
import { PdfPreview } from "@/components/pdf-pages-preview";

import { documentPreviewSandbox } from "../data/document-api";

/**
 * The body of a document preview dialog. A PDF is drawn by the app itself
 * (pdf.js): an `<iframe>` with a PDF stays an empty box where the browser's
 * built-in viewer is missing or switched off, while the download of the same
 * file works (owner report 2026-11-14, generated treatment plan). Images and
 * plain text keep the sandboxed `<iframe>`.
 */
export function DocumentPreviewSurface({
  preview,
  title,
  className,
  page,
}: {
  preview: { url?: string; contentType?: string; pdfData?: ArrayBuffer };
  title: string;
  className?: string;
  /** For a PDF: the page to scroll to. */
  page?: number;
}) {
  if (preview.pdfData) {
    return (
      <PdfPreview
        source={preview.pdfData}
        page={page}
        className={cn("overflow-y-auto rounded-lg border border-border bg-muted/40 p-3", className)}
      />
    );
  }
  return (
    <iframe
      title={title}
      src={preview.url}
      sandbox={documentPreviewSandbox(preview.contentType)}
      className={cn("rounded-lg border border-border bg-white", className)}
    />
  );
}
