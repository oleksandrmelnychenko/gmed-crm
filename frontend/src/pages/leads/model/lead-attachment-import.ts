import type { LeadDetail } from "@/lib/api/types";

import type { LeadAttachmentImportRefusal } from "../data/leads-api";

type Tx = (ru: string, de: string) => string;

type LeadAttachmentLike = LeadDetail["attachments"][number];

/**
 * Why the import of a questionnaire file was refused, in words
 * (`import_refusal_code` of the attachment, `crates/server/src/routes/leads.rs`).
 * An unknown code still reads as "not imported".
 */
export function attachmentImportRefusalText(code: string | null | undefined, tx: Tx): string {
  switch (code) {
    case "unsupported_file_type":
      return tx("Тип файла не поддерживается", "Dateityp wird nicht unterstützt");
    case "file_rejected":
      return tx("Файл отклонён проверкой", "Datei von der Prüfung abgelehnt");
    case "file_too_large":
    case "payload_too_large":
      return tx("Файл слишком большой", "Datei zu groß");
    case "file_empty":
    case "empty_file":
      return tx("Файл пустой", "Datei ist leer");
    default:
      return tx("Файл не импортирован", "Datei nicht übernommen");
  }
}

/** "не импортирован — <reason>" for a refused row of the attachment list; null for an imported or pending file. */
export function attachmentImportRefusalLabel(
  attachment: Pick<LeadAttachmentLike, "import_refused_at" | "import_refusal_code" | "imported_at">,
  tx: Tx,
): string | null {
  if (attachment.imported_at || !(attachment.import_refused_at || attachment.import_refusal_code)) return null;
  return `${tx("не импортирован", "nicht übernommen")} — ${attachmentImportRefusalText(attachment.import_refusal_code, tx)}`;
}

/**
 * The refused files of a lead: what the attachments carry (persisted) joined
 * with the answer of the import that just ran (the attachments of the lead
 * loaded before it do not know the refusal yet). One row per file.
 */
export function refusedLeadAttachments(
  attachments: readonly LeadAttachmentLike[] | null | undefined,
  fresh: readonly LeadAttachmentImportRefusal[] | null | undefined,
): LeadAttachmentImportRefusal[] {
  const byId = new Map<string, LeadAttachmentImportRefusal>();
  for (const attachment of attachments ?? []) {
    if (attachment.imported_at || !(attachment.import_refused_at || attachment.import_refusal_code)) continue;
    byId.set(attachment.id, { id: attachment.id, file_name: attachment.file_name, code: attachment.import_refusal_code ?? null });
  }
  for (const item of fresh ?? []) {
    if (!item?.id) continue;
    byId.set(item.id, { id: item.id, file_name: item.file_name, code: item.code ?? null });
  }
  return Array.from(byId.values());
}
