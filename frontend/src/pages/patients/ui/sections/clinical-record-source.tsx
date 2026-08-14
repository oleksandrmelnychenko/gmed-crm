import { cn } from "@/lib/utils";

type Bilingual = (ru: string, de: string) => string;

export type ClinicalRecordProvenance = {
  source_document_id?: string | null;
  source_document_name?: string | null;
  source_import_id?: string | null;
  source_page?: number | null;
};

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
  return (
    <div className={cn("min-w-0", className)} data-clinical-source={fromDocument ? "document" : "manual"}>
      <span
        className={cn(
          "inline-flex max-w-full rounded-full border px-2 py-0.5 text-[10px] font-semibold",
          fromDocument
            ? "border-orange-200 bg-orange-50 text-orange-700"
            : "border-border/60 bg-white text-muted-foreground",
        )}
      >
        {fromDocument
          ? tx("Из документа", "Aus Dokument")
          : tx("Создано вручную", "Manuell erstellt")}
      </span>
      {fromDocument && item.source_document_name ? (
        <span
          className="mt-0.5 block truncate text-[10px] text-muted-foreground"
          title={item.source_document_name}
        >
          {item.source_document_name}
          {item.source_page ? ` · S. ${item.source_page}` : ""}
        </span>
      ) : null}
    </div>
  );
}
