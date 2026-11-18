/**
 * A trusted person staff add or change in the wizard (owner 2026-11-18): the
 * same record and the same fields as a person the client names in the
 * cabinet (`leads.portal_trusted_persons`), so both sides show one list and
 * the consent form (Anlage 1) names the person.
 */

import { normalizeScopeCodes } from "@/lib/consent-recipient-scope";
import type { ConsentRecipient, ConsentRecipientRelation } from "@/pages/patient-lead/lead-request-api";
import { blankRecipient, contactValid, recipientDrafts, recipientProblems, recipientsToSend, type RecipientDraft } from "@/pages/patient-lead/lead-trusted-persons-model";

import type { LeadPortalConsentRecipient } from "./lead-portal-consents";
import { isParentOrGuardianRelation, type TrustedContactDraft } from "./lead-trusted-contacts";

/** A parent, guardian or authorised representative: they act for the lead and stay a wizard contact. */
export function actsForLeadRelation(relation: string): boolean {
  return isParentOrGuardianRelation(relation) || relation.trim().toLowerCase() === "representative";
}

/** The relation of a wizard contact as the cabinet names it; "" when the cabinet has none for it. */
function cabinetRelation(relation: string): ConsentRecipientRelation | "" {
  switch (relation.trim().toLowerCase()) {
    case "spouse":
      return "spouse";
    case "relative":
      return "relative";
    case "other":
      return "other";
    default:
      return "";
  }
}

/**
 * The draft of the dialog for a contact staff kept in the wizard's own list
 * before 2026-11-18 (spouse, relative, other): its data taken over, what the
 * cabinet asks in addition left to fill.
 */
export function trustedPersonDraftFromContact(contact: Pick<TrustedContactDraft, "name" | "relation" | "phone" | "email" | "birthDate" | "scopeCodes">): RecipientDraft {
  return {
    ...blankRecipient(),
    name: contact.name.trim(),
    relation: cabinetRelation(contact.relation),
    phone: contact.phone.trim(),
    birthDate: contact.birthDate.trim(),
    // The e-mail address goes with the person as its contact.
    contact: contactValid(contact.email) ? contact.email.trim() : "",
    scopeCodes: normalizeScopeCodes(contact.scopeCodes ?? []),
  };
}

/** The draft of the dialog for a stored person: every field as stored. */
export function trustedPersonDraftFromStored(person: LeadPortalConsentRecipient): RecipientDraft {
  // The cabinet's relation codes are the server's; a stored person carries one of them.
  return recipientDrafts([person as ConsentRecipient])[0];
}

/** The person to send, or `null` while a field is missing or wrong. */
export function trustedPersonToSend(draft: RecipientDraft): LeadPortalConsentRecipient | null {
  if (recipientProblems(draft).length > 0) return null;
  const [person] = recipientsToSend([draft]);
  // A stored or carried-over e-mail address (or older contact) stays with the person.
  const contact = person?.contact ?? (contactValid(draft.contact) ? draft.contact.trim() : "");
  return person ? { ...person, contact: contact || null } : null;
}

/** Why the server refused the person, in the staff language. */
export function staffTrustedPersonError(code: string | undefined, field: string | undefined, tx: (ru: string, de: string) => string): string {
  if (code === "trusted_person_exists") return tx("Этот человек уже есть в списке.", "Diese Person ist bereits in der Liste.");
  if (code === "trusted_person_changed") return tx("Запись изменилась — обновите мастер и повторите.", "Der Eintrag wurde geändert – laden Sie den Assistenten neu und wiederholen Sie es.");
  if (code === "consent_recorded_how_required") return tx("Укажите, как клиент дал согласие.", "Geben Sie an, wie der Kunde eingewilligt hat.");
  if (field === "persons") return tx("Не больше пяти доверенных лиц.", "Höchstens fünf Vertrauenspersonen.");
  if (field === "phone" || field === "contact") return tx("Укажите телефон, с которого человек будет звонить.", "Geben Sie die Telefonnummer an, von der die Person anruft.");
  if (field === "birth_date") return tx("Укажите дату рождения.", "Geben Sie das Geburtsdatum an.");
  if (field === "scope_codes") return tx("Выберите объём информации.", "Wählen Sie den Auskunftsumfang.");
  return tx("Не удалось сохранить.", "Speichern fehlgeschlagen.");
}
