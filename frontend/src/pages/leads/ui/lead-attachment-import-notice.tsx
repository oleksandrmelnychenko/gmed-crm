import { CircleAlert, Download } from "lucide-react";

import { Banner } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";

import type { LeadAttachmentImportRefusal } from "../data/leads-api";
import { attachmentImportRefusalText } from "../model/lead-attachment-import";

type Tx = (ru: string, de: string) => string;

/**
 * The questionnaire files the import refused (QA 2026-10-25): the file, the
 * reason per code and, for staff with medical access, «Скачать» so the file
 * is not lost. Nothing is rendered without refused files.
 */
export function LeadAttachmentImportNotice({
  refused,
  tx,
  canDownload,
  onDownload,
  className,
}: {
  refused: readonly LeadAttachmentImportRefusal[];
  tx: Tx;
  /** Staff with medical access (the server left the attachments in the payload). */
  canDownload: boolean;
  onDownload?: (file: LeadAttachmentImportRefusal) => void;
  className?: string;
}) {
  if (refused.length === 0) return null;
  return (
    <div role="status" className={className} data-testid="lead-attachment-import-notice">
      <Banner tone="warning">
        <div className="flex items-center gap-2 font-medium">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          {tx("Файлы опросника не импортированы", "Fragebogendateien nicht übernommen")}: {refused.length}
        </div>
        <ul className="mt-2 space-y-1.5">
          {refused.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs leading-5" data-attachment-refused={file.id}>
              <span className="min-w-0 break-words">
                <span className="font-medium">{file.file_name}</span>
                {" — "}
                {attachmentImportRefusalText(file.code, tx)}
              </span>
              {canDownload && onDownload ? (
                <Button type="button" variant="outline" size="xs" onClick={() => onDownload(file)}>
                  <Download aria-hidden="true" className="size-3.5" />
                  {tx("Скачать", "Herunterladen")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Banner>
    </div>
  );
}
