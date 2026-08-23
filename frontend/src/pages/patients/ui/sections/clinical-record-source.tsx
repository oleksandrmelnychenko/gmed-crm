import { useEffect, useRef, useState } from "react";
import { Download, Eye, FileWarning, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  createDocumentPreviewObjectUrl,
  downloadDocumentFile,
  revokeDocumentPreviewObjectUrl,
} from "@/pages/documents/data/document-api";

type Bilingual = (ru: string, de: string) => string;

export type ClinicalRecordProvenance = {
  source_document_id?: string | null;
  source_document_name?: string | null;
  source_import_id?: string | null;
  source_page?: number | null;
};

type DocumentPreview = {
  title: string;
  contentType?: string;
  url?: string;
};

function supportsInlinePreview(contentType?: string) {
  const mimeType = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mimeType === "application/pdf"
    || mimeType.startsWith("image/")
    || mimeType === "text/plain"
    || mimeType === "text/html";
}

export function ClinicalRecordSource({
  item,
  tx,
  className,
}: {
  item: ClinicalRecordProvenance;
  tx: Bilingual;
  className?: string;
}) {
  const fromDocument = Boolean(item.source_document_id || item.source_import_id);
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const previewUrlRef = useRef<string | null>(null);
  const previewRequestRef = useRef(0);

  useEffect(() => () => {
    previewRequestRef.current += 1;
    if (previewUrlRef.current) {
      revokeDocumentPreviewObjectUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  function closePreview() {
    previewRequestRef.current += 1;
    if (previewUrlRef.current) {
      revokeDocumentPreviewObjectUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreview(null);
    setPreviewBusy(false);
    setPreviewError("");
  }

  async function openPreview() {
    if (!item.source_document_id) return;
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    if (previewUrlRef.current) {
      revokeDocumentPreviewObjectUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreview({ title: item.source_document_name || tx("Документ", "Dokument") });
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const result = await createDocumentPreviewObjectUrl(item.source_document_id);
      if (previewRequestRef.current !== requestId) {
        revokeDocumentPreviewObjectUrl(result.url);
        return;
      }
      previewUrlRef.current = result.url;
      setPreview({
        title: item.source_document_name || tx("Документ", "Dokument"),
        contentType: result.contentType,
        url: result.url,
      });
    } catch {
      if (previewRequestRef.current === requestId) {
        setPreviewError(tx("Не удалось открыть документ", "Dokument konnte nicht geöffnet werden"));
      }
    } finally {
      if (previewRequestRef.current === requestId) setPreviewBusy(false);
    }
  }

  return (
    <>
      <div className={cn("min-w-0", className)} data-clinical-source={fromDocument ? "document" : "manual"}>
        {fromDocument && item.source_document_id ? (
          <button
            type="button"
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-left text-[10px] font-semibold text-orange-700 transition-colors hover:border-orange-300 hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/60"
            title={`${tx("Предпросмотр документа", "Dokumentvorschau")}: ${item.source_document_name || tx("Документ", "Dokument")}`}
            onClick={(event) => {
              event.stopPropagation();
              void openPreview();
            }}
          >
            <Eye className="size-3 shrink-0" aria-hidden="true" />
            <span className="shrink-0">{tx("Из документа", "Aus Dokument")}</span>
            {item.source_document_name ? (
              <>
                <span aria-hidden="true" className="text-orange-400">·</span>
                <span className="truncate font-medium">
                  {item.source_document_name}
                  {item.source_page ? ` · S. ${item.source_page}` : ""}
                </span>
              </>
            ) : null}
          </button>
        ) : (
          <span
            className={cn(
              "inline-flex max-w-full rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              fromDocument
                ? "border-orange-200 bg-orange-50 text-orange-700"
                : "border-border/60 bg-white text-muted-foreground",
            )}
            title={fromDocument ? item.source_document_name ?? undefined : undefined}
          >
            {fromDocument
              ? [tx("Из документа", "Aus Dokument"), item.source_document_name, item.source_page ? `S. ${item.source_page}` : null]
                  .filter(Boolean)
                  .join(" · ")
              : tx("Создано вручную", "Manuell erstellt")}
          </span>
        )}
      </div>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) closePreview(); }}>
        <DialogContent
          className="flex h-[86vh] w-[94vw] max-w-none flex-col overflow-hidden rounded-xl p-0 duration-0 data-closed:animate-none data-open:animate-none sm:w-[78vw] sm:max-w-[1500px]"
          onClick={(event) => event.stopPropagation()}
        >
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <div className="flex min-w-0 items-start justify-between gap-4 pr-10">
              <div className="min-w-0">
                <DialogTitle className="truncate text-base">
                  {preview?.title ?? tx("Предпросмотр документа", "Dokumentvorschau")}
                </DialogTitle>
                <DialogDescription className="truncate">
                  {previewBusy
                    ? tx("Загрузка документа…", "Dokument wird geladen…")
                    : preview?.contentType || tx("Предпросмотр документа", "Dokumentvorschau")}
                </DialogDescription>
              </div>
              {item.source_document_id ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 rounded-lg"
                  onClick={() => void downloadDocumentFile(
                    item.source_document_id!,
                    item.source_document_name || tx("Документ", "Dokument"),
                  )}
                >
                  <Download className="size-3.5" />
                  {tx("Скачать", "Herunterladen")}
                </Button>
              ) : null}
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 bg-slate-50 p-3">
            {previewBusy ? (
              <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-border bg-white text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {tx("Загрузка документа…", "Dokument wird geladen…")}
              </div>
            ) : previewError ? (
              <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-destructive/30 bg-white p-8 text-center text-sm text-destructive">
                {previewError}
              </div>
            ) : preview?.url && supportsInlinePreview(preview.contentType) ? (
              <iframe
                title={preview.title}
                src={preview.url}
                sandbox={preview.contentType?.startsWith("text/html") ? "" : undefined}
                className="h-full min-h-[560px] w-full rounded-lg border border-border bg-white"
              />
            ) : preview?.url ? (
              <div className="flex h-full min-h-80 flex-col items-center justify-center rounded-lg border border-border bg-white p-8 text-center">
                <FileWarning className="mb-3 size-8 text-muted-foreground" />
                <p className="max-w-md text-sm text-muted-foreground">
                  {tx(
                    "Этот формат нельзя показать прямо в браузере. Скачайте файл, чтобы открыть его.",
                    "Dieses Dateiformat kann nicht direkt im Browser angezeigt werden. Laden Sie die Datei herunter.",
                  )}
                </p>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
