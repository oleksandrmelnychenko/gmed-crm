import { Badge } from "@/components/ui/badge";
import { STATUS_TONE } from "@/components/ui-shell";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/pages/leads/model/leads-model";
import type { DocumentItem } from "@/pages/documents/model/types";

export const metadataPillClass = "rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tabular-nums";

type LeadWizardDocumentMetadataProps = {
  document: Pick<
    DocumentItem,
    "created_at" | "document_number" | "file_size" | "generated_template_id" | "id"
  >;
  lang: Lang;
};

function formatFileSize(size: number | null, lang: Lang) {
  if (!size || size <= 0) return "";
  const formatter = new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
    maximumFractionDigits: size >= 1024 * 1024 ? 1 : 0,
  });
  if (size >= 1024 * 1024) return `${formatter.format(size / (1024 * 1024))} MB`;
  return `${formatter.format(size / 1024)} KB`;
}

export function LeadWizardDocumentMetadata({
  document,
  lang,
}: LeadWizardDocumentMetadataProps) {
  const sizeLabel = formatFileSize(document.file_size, lang);
  const generatedAtLabel = document.generated_template_id?.trim()
    ? formatDateTime(
        document.created_at,
        lang === "de" ? "de-DE" : "ru-RU",
        "",
      )
    : "";

  return (
    <>
      <Badge variant="outline" className={cn(metadataPillClass, STATUS_TONE.brand)}>
        {document.document_number || `DOC-${document.id.slice(0, 8).toUpperCase()}`}
      </Badge>
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
