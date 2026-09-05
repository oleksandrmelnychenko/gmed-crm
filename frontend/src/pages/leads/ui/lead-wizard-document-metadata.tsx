import { Badge } from "@/components/ui/badge";
import { STATUS_TONE } from "@/components/ui-shell";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { cachedNumberFormat } from "@/lib/intl-cache";
import { formatDateTime } from "@/pages/leads/model/leads-model";
import type { DocumentItem } from "@/pages/documents/model/types";

export const metadataPillClass = "rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums";

type LeadWizardDocumentMetadataProps = {
  document: Pick<
    DocumentItem,
    "created_at" | "document_number" | "file_size" | "generated_template_id" | "id"
  > & Partial<Pick<DocumentItem, "version_number" | "version_count" | "is_latest_version">>;
  lang: Lang;
};

function formatFileSize(size: number | null, lang: Lang) {
  if (!size || size <= 0) return "";
  const formatter = cachedNumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
    maximumFractionDigits: size >= 1024 * 1024 ? 1 : 0,
  });
  if (size >= 1024 * 1024) return `${formatter.format(size / (1024 * 1024))} MB`;
  return `${formatter.format(size / 1024)} KB`;
}

export function leadWizardDocumentNumber(
  document: Pick<DocumentItem, "document_number" | "id">,
) {
  const documentNumber = document.document_number?.trim();
  return documentNumber
    ? documentNumber.replace(/-V\d+$/i, "")
    : `DOC-${document.id.slice(0, 8).toUpperCase()}`;
}

export function LeadWizardDocumentMetadata({
  document,
  lang,
}: LeadWizardDocumentMetadataProps) {
  const sizeLabel = formatFileSize(document.file_size, lang);
  const versionNumber = Number(document.document_number?.match(/-V(\d+)$/i)?.[1])
    || document.version_number
    || 1;
  const showVersion = versionNumber > 1 || (document.version_count ?? 1) > 1;
  const generatedAtLabel = document.generated_template_id?.trim()
    ? formatDateTime(
        document.created_at,
        lang === "de" ? "de-DE" : "ru-RU",
        "",
      )
    : "";

  return (
    <>
      <Badge variant="outline" title={document.document_number} className={cn(metadataPillClass, STATUS_TONE.brand)}>
        {leadWizardDocumentNumber(document)}
      </Badge>
      {showVersion ? (
        <span>
          {lang === "de" ? "Version" : "Версия"} {versionNumber}
          {document.is_latest_version === false ? (lang === "de" ? " · vorherige" : " · предыдущая") : ""}
        </span>
      ) : null}
      {sizeLabel ? <span className="font-mono tabular-nums">{sizeLabel}</span> : null}
      {generatedAtLabel ? (
        <Badge
          variant="outline"
          data-generated-document-date
          className={cn(metadataPillClass, STATUS_TONE.info)}
        >
          <time dateTime={document.created_at}>{generatedAtLabel}</time>
        </Badge>
      ) : null}
    </>
  );
}
