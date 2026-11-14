import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { documentPreviewSandbox } from "../data/document-api";
import { PdfPagesPreview } from "./pdf-pages-preview";

const LABELS = {
  ru: {
    page: "PDF, страница",
    failed: "Не удалось показать PDF. Файл можно скачать.",
  },
  de: {
    page: "PDF, Seite",
    failed: "Das PDF kann nicht angezeigt werden. Die Datei kann heruntergeladen werden.",
  },
} as const;

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
}: {
  preview: { url?: string; contentType?: string; pdfData?: ArrayBuffer };
  title: string;
  className?: string;
}) {
  const { lang } = useLang();
  const labels = lang === "de" ? LABELS.de : LABELS.ru;
  if (preview.pdfData) {
    return (
      <PdfPagesPreview
        data={preview.pdfData}
        pageLabel={labels.page}
        failedLabel={labels.failed}
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
