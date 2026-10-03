import { useId, useState } from "react";
import { FileText, LoaderCircle, Upload, X } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadDocument } from "@/pages/documents/data/document-api";
import {
  MAX_ASSET_ORIGIN_EVIDENCE,
  MAX_ASSET_ORIGIN_EVIDENCE_FILE_SIZE,
  assetOriginEvidenceUploadForm,
  type AssetOriginEvidence,
  type AssetOriginEvidenceSubject,
} from "@/pages/documents/model/asset-origin-evidence";

type Props = {
  value: AssetOriginEvidence[];
  /** The patient or lead the proofs are filed under; without one nothing can be uploaded. */
  subject: AssetOriginEvidenceSubject;
  lang: "de" | "ru";
  disabled?: boolean;
  onChange: (next: AssetOriginEvidence[]) => void;
};

/**
 * Upload of the proofs of where the assets come from (§ 15 Abs. 4 Nr. 2 GwG),
 * below the "Herkunft der eingesetzten Vermögenswerte" text. Every file is
 * stored at once as a document of the patient or lead; the due-diligence form
 * keeps the references and lists the files by name.
 */
export function AssetOriginEvidenceField({ value, subject, lang, disabled = false, onChange }: Props) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const hasSubject = Boolean(subject.patientId?.trim() || subject.leadId?.trim());
  const blocked = disabled || uploading || !hasSubject;

  async function upload(files: File[]) {
    if (files.length === 0 || !hasSubject) return;
    setError("");
    if (value.length + files.length > MAX_ASSET_ORIGIN_EVIDENCE) {
      setError(tx(
        `Не больше ${MAX_ASSET_ORIGIN_EVIDENCE} файлов`,
        `Höchstens ${MAX_ASSET_ORIGIN_EVIDENCE} Dateien`,
      ));
      return;
    }
    if (files.some((file) => file.size > MAX_ASSET_ORIGIN_EVIDENCE_FILE_SIZE)) {
      setError(tx("Размер файла не должен превышать 25 МБ", "Die Datei darf höchstens 25 MB groß sein"));
      return;
    }
    setUploading(true);
    let next = value;
    try {
      for (const file of files) {
        const form = assetOriginEvidenceUploadForm(file, subject);
        if (!form) break;
        const uploaded = await uploadDocument(form);
        // Reported after every file, so an error half-way keeps what was stored.
        next = [...next, { documentId: uploaded.id, filename: file.name }];
        onChange(next);
      }
    } catch (cause) {
      setError(cause instanceof Error && cause.message
        ? cause.message
        : tx("Не удалось загрузить файл", "Datei konnte nicht hochgeladen werden"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div data-asset-origin-evidence className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase text-muted-foreground">
          {tx("Подтверждающие документы о происхождении активов", "Nachweise zur Herkunft der Vermögenswerte")}
        </span>
        <span className="inline-flex">
          <input
            id={inputId}
            type="file"
            multiple
            className="peer sr-only"
            accept=".pdf,.jpg,.jpeg,.png"
            disabled={blocked}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void upload(files);
            }}
          />
          <label
            htmlFor={inputId}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "h-8 cursor-pointer rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
              blocked && "pointer-events-none opacity-50",
            )}
          >
            {uploading
              ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              : <Upload aria-hidden="true" className="size-3.5" />}
            {uploading ? tx("Загрузка…", "Wird hochgeladen…") : tx("Загрузить файлы", "Dateien hochladen")}
          </label>
        </span>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {hasSubject
          ? tx(
              "Выписки со счёта, договоры купли-продажи, справки о доходах и т. п. (PDF, JPG, PNG). Файлы сохраняются в документах и перечисляются в формуляре.",
              "Kontoauszüge, Kaufverträge, Einkommensnachweise u. Ä. (PDF, JPG, PNG). Die Dateien werden in der Akte abgelegt und im Dokumentationsbogen aufgeführt.",
            )
          : tx("Сначала выберите пациента.", "Wählen Sie zuerst den Patienten aus.")}
      </p>
      {value.length > 0 ? (
        <ul className="border-y border-border/70">
          {value.map((item) => (
            <li
              key={item.documentId}
              className="flex min-h-10 items-center justify-between gap-3 border-b border-border/70 py-2 last:border-b-0"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.filename || tx("Документ", "Dokument")}</span>
              </span>
              <button
                type="button"
                disabled={disabled || uploading}
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                title={tx("Убрать из формуляра (файл остаётся в документах)", "Aus dem Bogen entfernen (die Datei bleibt in der Akte)")}
                aria-label={`${tx("Убрать", "Entfernen")}: ${item.filename}`}
                onClick={() => onChange(value.filter((entry) => entry.documentId !== item.documentId))}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert" className="text-xs leading-4 text-destructive">{error}</p> : null}
    </div>
  );
}
