import { useId, useState, type ReactNode } from "react";
import { CalendarDays, FileText, LoaderCircle, Upload } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { formatAppDate } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import type { LeadCustody, LeadIdentityDocument, LeadRepresentative } from "../data/lead-portal-intake-api";
import { uploadRepresentativeDocument, type RepresentativeUploadKind } from "../data/lead-risk-api";
import type { Tx } from "../model/lead-payer";
import { leadErrorMessage } from "../model/leads-model";
import { LEAD_UPLOAD_ACCEPT } from "@/pages/patient-lead/lead-request-model";

const MAX_REPRESENTATIVE_FILE_SIZE = 25 * 1024 * 1024;

/**
 * Whether the person's proof of authority is asked for: the contract gate
 * needs it of an adult's agent or guardian and of the guardian (Vormund) of
 * a minor; the cabinet also asks a parent with sole custody for the
 * (optional) proof of it, so staff can upload it too. A file on record stays
 * in sight either way.
 */
export function representativeNeedsAuthority(person: LeadRepresentative, custody: LeadCustody | null | undefined) {
  if (person.authority_documents.length > 0) return true;
  if (person.slot === "agent" || person.slot === "guardian") return true;
  return (custody === "guardian" || custody === "sole_parent") && person.slot === "rep1";
}

/** Who uploaded a representative's file: the cabinet (the lead or a parent) or staff in the wizard. */
export function representativeFileOrigin(file: Pick<LeadIdentityDocument, "uploaded_by_staff">, tx: Tx) {
  return file.uploaded_by_staff ? tx("Загружено сотрудником", "Von GMED hochgeladen") : tx("Из кабинета", "Aus dem Kundenkabinett");
}

function filesOf(person: LeadRepresentative, kind: RepresentativeUploadKind) {
  return kind === "authority" ? person.authority_documents : person.identity_documents;
}

function UploadBlock({
  leadId,
  person,
  kind,
  tx,
  disabled,
  renderFiles,
  onUploaded,
}: {
  leadId: string;
  person: LeadRepresentative;
  kind: RepresentativeUploadKind;
  tx: Tx;
  disabled: boolean;
  renderFiles?: (person: LeadRepresentative, kind: RepresentativeUploadKind) => ReactNode;
  onUploaded: () => void;
}) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const files = filesOf(person, kind);
  const title = kind === "authority"
    ? tx("Подтверждение полномочий", "Vertretungsnachweis")
    : tx("Скан документа", "Ausweiskopie");
  const upload = async (file: File) => {
    // The server refuses more than 25 MB; say so before sending it.
    if (file.size > MAX_REPRESENTATIVE_FILE_SIZE) {
      setError(tx("Размер файла не должен превышать 25 МБ", "Die Datei darf höchstens 25 MB groß sein"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await uploadRepresentativeDocument(leadId, person.id, kind, file);
      onUploaded();
    } catch (uploadError) {
      // The server's code in the user's language (a duplicate, a refused type, …).
      setError(leadErrorMessage(uploadError, tx, tx("Не удалось загрузить файл", "Hochladen fehlgeschlagen")));
    } finally {
      setBusy(false);
    }
  };
  const rendered = files.length > 0 ? renderFiles?.(person, kind) : null;
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-card p-3" data-testid={`lead-representative-upload-${kind}-${person.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />{title}</span>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone="warning">{tx("PDF, JPG или PNG · до 25 МБ", "PDF, JPG oder PNG · bis 25 MB")}</StatusChip>
          <span className="inline-flex">
            <input
              id={inputId}
              type="file"
              className="peer sr-only"
              accept={LEAD_UPLOAD_ACCEPT}
              disabled={disabled || busy}
              data-testid={`lead-representative-upload-${kind}-${person.id}-input`}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void upload(file);
              }}
            />
            <label
              htmlFor={inputId}
              className={cn(
                buttonVariants({ variant: "default", size: "sm" }),
                "h-8 rounded-lg bg-[var(--brand)] text-white hover:brightness-95 peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                (disabled || busy) && "pointer-events-none opacity-50",
              )}
            >
              {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Upload aria-hidden="true" className="size-3.5" />}
              {busy
                ? tx("Загрузка…", "Wird hochgeladen…")
                : files.length > 0
                  ? tx("Добавить файл", "Datei hinzufügen")
                  : tx("Загрузить файл", "Datei hochladen")}
            </label>
          </span>
        </div>
      </div>
      {files.length === 0 ? (
        <p className="text-xs text-foreground/80">
          {tx("Файл не загружен", "Keine Datei hochgeladen")}
        </p>
      ) : rendered ?? (
        <ul className="space-y-1 text-xs">
          {files.map((file) => (
            <li key={file.id} className="flex min-w-0 flex-wrap items-center gap-2">
              <StatusChip className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200"><FileText aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{file.file_name || "—"}</span></StatusChip>
              {file.uploaded_at ? <StatusChip tone="info"><CalendarDays aria-hidden="true" />{formatAppDate(file.uploaded_at)}</StatusChip> : null}
              <StatusChip tone="warning">{representativeFileOrigin(file, tx)}</StatusChip>
            </li>
          ))}
        </ul>
      )}
      {error ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Staff upload a representative's identity document copy and, where the
 * contract gate asks for it, the proof of authority (owner report
 * 2026-10-19: the gate asked for files staff could not upload). The files go
 * where the cabinet's go; `renderFiles` lists them with open and download.
 */
export function LeadRepresentativeUploads({
  leadId,
  person,
  custody,
  tx,
  disabled = false,
  renderFiles,
  onUploaded,
}: {
  leadId: string;
  person: LeadRepresentative;
  custody: LeadCustody | null | undefined;
  tx: Tx;
  disabled?: boolean;
  renderFiles?: (person: LeadRepresentative, kind: RepresentativeUploadKind) => ReactNode;
  /** After an upload: reload the representation, the risk assessment and the document list. */
  onUploaded: () => void;
}) {
  const kinds: RepresentativeUploadKind[] = representativeNeedsAuthority(person, custody)
    ? ["identity", "authority"]
    : ["identity"];
  return (
    <div className="space-y-2.5" data-testid={`lead-representative-uploads-${person.id}`}>
      {kinds.map((kind) => (
        <UploadBlock
          key={kind}
          leadId={leadId}
          person={person}
          kind={kind}
          tx={tx}
          disabled={disabled}
          renderFiles={renderFiles}
          onUploaded={onUploaded}
        />
      ))}
    </div>
  );
}
