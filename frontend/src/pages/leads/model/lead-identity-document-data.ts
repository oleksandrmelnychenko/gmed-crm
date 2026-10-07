/**
 * Identity document data entered by staff from the uploaded scan (trigger
 * flow 2026-10-07: the lead only uploads the document). One source on the
 * server (`lead_gwg_declarations` / `lead_representatives`): the GwG sheet,
 * the portal state and the conversion read it. A past "valid until" is
 * accepted; it counts as trigger T12, like "Ausweis unleserlich".
 */
import { appDateKeyOf, formatAppDateTime } from "@/lib/app-time-zone";

import type { IdentityDocumentDataInput } from "../data/lead-risk-api";
import type { Tx } from "./lead-payer";
import type { LeadStaffIdDataMarks } from "./lead-risk-intake";

export const ID_DOCUMENT_TYPES = ["passport", "id_card", "residence_permit"] as const;

/** The stored values the form starts from (the portal state's identification or a representative). */
export type IdentityDocumentSource = {
  id_document_type: string | null;
  id_document_number: string | null;
  id_issuing_authority: string | null;
  id_issuing_country: string | null;
  id_issued_on: string | null;
  id_valid_until: string | null;
} & LeadStaffIdDataMarks;

export type IdentityDocumentDraft = {
  type: string;
  number: string;
  authority: string;
  country: string;
  issuedOn: string;
  validUntil: string;
  unreadable: boolean;
};

const dateKey = (value: string | null | undefined) => appDateKeyOf(value);

/**
 * The form values of a stored document; `fallbackValidUntil` is the wizard's
 * old "passport valid until" while nothing was stored in the new place.
 */
export function identityDocumentDraft(
  source: IdentityDocumentSource | null | undefined,
  fallbackValidUntil = "",
): IdentityDocumentDraft {
  return {
    type: source?.id_document_type ?? "",
    number: source?.id_document_number ?? "",
    authority: source?.id_issuing_authority ?? "",
    country: (source?.id_issuing_country ?? "").toUpperCase(),
    issuedOn: dateKey(source?.id_issued_on),
    validUntil: dateKey(source?.id_valid_until) || dateKey(fallbackValidUntil),
    unreadable: source?.id_document_unreadable === true,
  };
}

const orNull = (value: string) => (value.trim() ? value.trim() : null);

/** The PUT body: empty fields are null. */
export function identityDocumentInput(draft: IdentityDocumentDraft): IdentityDocumentDataInput {
  return {
    id_document_type: orNull(draft.type),
    id_document_number: orNull(draft.number),
    id_issuing_authority: orNull(draft.authority),
    id_issuing_country: orNull(draft.country)?.toUpperCase() ?? null,
    id_issued_on: orNull(draft.issuedOn),
    id_valid_until: orNull(draft.validUntil),
    id_document_unreadable: draft.unreadable,
  };
}

export function identityDocumentDraftChanged(current: IdentityDocumentDraft, saved: IdentityDocumentDraft): boolean {
  return JSON.stringify(identityDocumentInput(current)) !== JSON.stringify(identityDocumentInput(saved));
}

/** Whether the document has expired on `today` (Berlin date key). */
export function identityDocumentExpired(draft: IdentityDocumentDraft, today: string): boolean {
  return Boolean(draft.validUntil) && draft.validUntil < today;
}

/** An issue date after the expiry date is a typing error. */
export function identityDocumentDatesInvalid(draft: IdentityDocumentDraft): boolean {
  return Boolean(draft.issuedOn && draft.validUntil) && draft.issuedOn > draft.validUntil;
}

/** "Внесено сотрудником: Ben Muster · 07.10.2026 12:00"; "" while staff entered nothing. */
export function identityDocumentEnteredLine(marks: LeadStaffIdDataMarks | null | undefined, tx: Tx): string {
  if (!marks?.id_data_entered_by_name && !marks?.id_data_entered_at) return "";
  const parts = [marks.id_data_entered_by_name, formatAppDateTime(marks.id_data_entered_at ?? null)].filter(Boolean);
  return `${tx("Внесено сотрудником", "Erfasst von")}: ${parts.join(" · ")}`;
}
