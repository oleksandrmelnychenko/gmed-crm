import { formatAppDate } from "@/lib/app-time-zone";
import type { DocumentItem } from "@/pages/documents/model/types";

import type { Tx } from "./lead-payer";

/**
 * The staff paper path of a third-party payer (DEV re-check V-A7): a payer
 * without e-mail, or who prefers paper, is identified without the payer
 * link — staff upload the payer's identity document ("Ausweis (Zahler/in)")
 * and file the Selbstauskunft generated as a paper form and signed by hand
 * («Подписано на бумаге»). The server counts both for the readiness check
 * `payer_identified` (`lead_payer.rs`, `payer_identified`).
 */

/** `status.identification` of `GET /leads/{id}/payer-declaration`; null without a third-party payer of his own. */
export type PayerIdentificationStatus = {
  /** The lead's risk asks the payer to identify himself (level 2 or a trigger of the payer's person). */
  required: boolean;
  identified: boolean;
  /** The questionnaire was sent through the link (or adopted). */
  statement_sent: boolean;
  /** A signed Selbstauskunft is on file (QES or the scan of the paper copy). */
  self_disclosure_signed: boolean;
  identity_document: boolean;
  /** Staff entered the sent answers from the paper Selbstauskunft (owner 2026-10-30); absent on an older server. */
  statement_by_staff?: boolean;
};

/** The anchor the readiness reason `payer_not_identified` focuses. */
export const PAYER_PAPER_PATH_ID = "lead-wizard-payer-paper-path";

/** The payer's identity document types the paper form offers. */
export const PAYER_ID_DOCUMENT_TYPES = ["passport", "id_card", "residence_permit"] as const;

export type PayerIdDocumentType = (typeof PAYER_ID_DOCUMENT_TYPES)[number];

/** The optional data of the payer's identity document staff read from the copy. */
export type PayerIdentityFields = {
  type: PayerIdDocumentType | "";
  number: string;
  issuingCountry: string;
  validUntil: string;
  /** An organisation: whose document it is (the contact person / representative). */
  holder?: string;
  /** An organisation: the copy is its commercial register extract, not a person's ID. */
  registerExtract?: boolean;
};

export const EMPTY_PAYER_IDENTITY_FIELDS: PayerIdentityFields = {
  type: "",
  number: "",
  issuingCountry: "",
  validUntil: "",
  holder: "",
  registerExtract: false,
};

const ID_DOCUMENT_TYPE_DE: Record<PayerIdDocumentType, string> = {
  passport: "Reisepass",
  id_card: "Personalausweis",
  residence_permit: "Aufenthaltstitel",
};

export function payerIdDocumentTypeLabel(type: PayerIdDocumentType, tx: Tx): string {
  switch (type) {
    case "passport":
      return tx("Паспорт", "Reisepass");
    case "id_card":
      return tx("ID-карта", "Personalausweis");
    case "residence_permit":
      return tx("Вид на жительство", "Aufenthaltstitel");
  }
}

/**
 * The optional ID data as the document's note, in German like every
 * document of the lead ("Reisepass Nr. P123, Ausstellungsstaat DE, gültig bis
 * 31.12.2031"); null when nothing was entered.
 */
export function payerIdentityNotes(fields: PayerIdentityFields): string | null {
  const parts: string[] = [];
  const holder = fields.holder?.trim() ?? "";
  // The server knows a register extract by this note (owner 2026-10-30: enough for an organisation).
  if (fields.registerExtract) return holder ? `Handelsregisterauszug, vorgelegt von ${holder}` : "Handelsregisterauszug";
  const number = fields.number.trim();
  const kind = fields.type ? ID_DOCUMENT_TYPE_DE[fields.type] : "";
  if (kind || number) parts.push([kind || "Ausweisdokument", number ? `Nr. ${number}` : ""].filter(Boolean).join(" "));
  const country = fields.issuingCountry.trim().toUpperCase();
  if (country) parts.push(`Ausstellungsstaat ${country}`);
  if (fields.validUntil) parts.push(`gültig bis ${formatAppDate(fields.validUntil)}`);
  // Last: the GwG sheet reads the type and number from the first part (F3, DEV QA 2026-10-30).
  if (holder) parts.push(`Inhaber/in ${holder}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * The document's German name: a person's ID, an organisation's contact
 * person's ID ("Ausweisdokument – vertretungsberechtigte Person Vera Muster
 * für Kostenübernehmer Beispiel GmbH") or the organisation's commercial
 * register extract (DEV QA 2026-10-30: the copy named the GmbH as the ID's
 * holder).
 */
export function payerIdentityDocumentName(payerName: string, fields: PayerIdentityFields, organisation = false): string {
  const name = payerName.trim();
  if (!organisation) return name ? `Ausweisdokument – Kostenübernehmer/in ${name}` : "Ausweisdokument – Kostenübernehmer/in";
  const payer = name ? ` – Kostenübernehmer ${name}` : " – Kostenübernehmer";
  if (fields.registerExtract) return `Handelsregisterauszug${payer}`;
  const holder = fields.holder?.trim();
  return `Ausweisdokument – vertretungsberechtigte Person${holder ? ` ${holder}` : ""}${name ? ` für Kostenübernehmer ${name}` : ""}`;
}

/** The multipart body of `POST /documents/upload` for the payer's identity document on the lead. */
export function payerIdentityUploadForm(
  leadId: string,
  file: File,
  payerName: string,
  fields: PayerIdentityFields,
  organisation = false,
): FormData {
  const form = new FormData();
  form.set("file", file);
  form.set("lead_id", leadId);
  form.set("art", "payer_identity");
  form.set("category", "identity");
  form.set("auto_name", payerIdentityDocumentName(payerName, fields, organisation));
  form.set("document_direction", "incoming");
  form.set("access_category", "internal");
  form.set("visibility", "internal");
  form.set("is_medical", "false");
  form.set("source_person", "payer");
  form.set("ursprung", "staff_paper_path");
  const notes = payerIdentityNotes(fields);
  if (notes) form.set("notes", notes);
  return form;
}

/** The body of `POST /documents/generate` for the paper Selbstauskunft (a new version replaces `replaceDocumentId`). */
export function paperSelfDisclosurePayload(leadId: string, replaceDocumentId?: string | null) {
  return {
    template_id: "payer_self_disclosure",
    lead_id: leadId,
    paper_form: true,
    ...(replaceDocumentId ? { replace_document_id: replaceDocumentId } : {}),
    language: "de",
    document_language: "de",
    document_direction: "outgoing",
    document_variant: "original",
    status: "active",
  };
}

const usable = (document: DocumentItem) =>
  document.status !== "archived" && !document.file_deleted_at;

/** The payer's paper documents of the lead: the current Selbstauskunft and the identity documents. */
export function payerPaperDocuments(documents: readonly DocumentItem[]): {
  selfDisclosure: DocumentItem | null;
  identity: DocumentItem[];
} {
  const newestFirst = (left: DocumentItem, right: DocumentItem) => (right.created_at ?? "").localeCompare(left.created_at ?? "");
  const selfDisclosure = documents
    .filter((document) => usable(document) && document.is_latest_version
      && (document.generated_template_id === "payer_self_disclosure" || document.art === "payer_self_disclosure"))
    .sort(newestFirst)[0] ?? null;
  const identity = documents
    .filter((document) => usable(document) && document.art === "payer_identity")
    .sort(newestFirst);
  return { selfDisclosure, identity };
}

/**
 * The readiness reason / 422 `payer_not_identified` (re-check V-A7): the
 * link or the paper path.
 */
export function payerNotIdentifiedHint(tx: Tx): string {
  return tx(
    "Заполните анкету плательщика по ссылке или загрузите подписанную на бумаге Selbstauskunft и документ плательщика",
    "Fragebogen des Zahlers über den Link ausfüllen lassen oder die auf Papier unterschriebene Selbstauskunft und den Ausweis des Zahlers hochladen",
  );
}

/** One line of the paper path's state, or null while nothing is asked. */
export function payerIdentificationLine(
  identification: PayerIdentificationStatus | null | undefined,
  tx: Tx,
): { tone: "success" | "warning" | "neutral"; text: string } | null {
  if (!identification) return null;
  if (identification.identified) {
    return { tone: "success", text: tx("Плательщик идентифицирован", "Zahler/in identifiziert") };
  }
  if (identification.required) return { tone: "warning", text: payerNotIdentifiedHint(tx) };
  return {
    tone: "neutral",
    text: tx(
      "Идентификация плательщика при текущем уровне риска не требуется",
      "Identifizierung des Zahlers bei der aktuellen Risikostufe nicht erforderlich",
    ),
  };
}

/** `status.identification` as the server sent it; null for anything else. */
export function normalizePayerIdentification(value: unknown): PayerIdentificationStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    required: record.required === true,
    identified: record.identified === true,
    statement_sent: record.statement_sent === true,
    self_disclosure_signed: record.self_disclosure_signed === true,
    identity_document: record.identity_document === true,
    statement_by_staff: record.statement_by_staff === true,
  };
}

/**
 * Whether the wizard opens «Анкета плательщика» on the paper path: staff
 * entered the answers from paper, or the payer answered on paper only (a
 * signed paper Selbstauskunft, no link statement), or paper documents of the
 * payer are on file while no link answers exist. The choice is derived, so a
 * reload keeps it (DEV QA 2026-10-30).
 */
export function payerPaperPathDerived(
  identification: PayerIdentificationStatus | null | undefined,
  paperDocumentCount: number,
  linkSubmitted: boolean,
): boolean {
  if (!identification) return false;
  if (identification.statement_by_staff) return true;
  if (identification.statement_sent || linkSubmitted) return false;
  return identification.self_disclosure_signed || paperDocumentCount > 0;
}

/**
 * The ID data an uploaded copy carries, as the questionnaire's keys: they
 * fill the payer's identity document — the contact person's for an
 * organisation — in the paper answers (DEV QA 2026-10-30). Empty fields are
 * left out.
 */
export function payerIdentityAnswersPatch(fields: PayerIdentityFields): Record<string, string> {
  const patch: Record<string, string> = {};
  if (fields.registerExtract) return patch;
  if (fields.type) patch.id_document_type = fields.type;
  const number = fields.number.trim();
  if (number) patch.id_document_number = number;
  const country = fields.issuingCountry.trim().toUpperCase();
  if (country) patch.id_issuing_country = country;
  if (fields.validUntil) patch.id_valid_until = fields.validUntil;
  return patch;
}
