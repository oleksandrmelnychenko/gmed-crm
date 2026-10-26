/**
 * One list of the people and institutions of a lead on the wizard's documents
 * step (owner 2026-10-26: «кожна особа один раз з мітками»). Two sources stay
 * apart in the data: the contacts and representatives staff record, and the
 * persons the client names in the cabinet (Auskunft an Dritte, Anlage 1),
 * which staff never change. A person in both appears once.
 */

import type { LeadPortalConsentForm, LeadPortalConsentRecipient } from "./lead-portal-consents";
import { isParentOrGuardianRelation } from "./lead-trusted-contacts";

/** A cabinet person as the wizard reads it; phone and birth date since 2026-10-26. */
export type CabinetPerson = LeadPortalConsentRecipient & {
  phone?: string | null;
  birth_date?: string | null;
};

type StaffContact = { id: string; name: string; relation: string };

export type LeadPersonRow<T extends StaffContact> = {
  key: string;
  name: string;
  /** The entry staff recorded (editable), if any. */
  contact: T | null;
  /** What the client stated in the cabinet (read-only), if any. */
  cabinet: CabinetPerson | null;
};

/** «Kurz, Inga» and «Inga Kurz» are the same person. */
export function personNameKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLocaleLowerCase("de-DE")
    .replace(/[,;.]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/**
 * Staff contacts first (in their order), each with the cabinet person of the
 * same name attached; then the cabinet persons nobody recorded.
 */
export function mergeLeadPeople<T extends StaffContact>(
  contacts: readonly T[],
  cabinetPersons: readonly CabinetPerson[],
): LeadPersonRow<T>[] {
  const rows: LeadPersonRow<T>[] = contacts.map((contact) => ({
    key: `staff:${contact.id}`,
    name: contact.name,
    contact,
    cabinet: null,
  }));
  const seen = new Set<string>();
  cabinetPersons.forEach((person, index) => {
    const nameKey = personNameKey(person.name);
    if (!nameKey || seen.has(nameKey)) return;
    seen.add(nameKey);
    const row = rows.find((candidate) => candidate.contact && !candidate.cabinet && personNameKey(candidate.name) === nameKey);
    if (row) row.cabinet = person;
    else rows.push({ key: `cabinet:${index}:${nameKey}`, name: person.name.trim(), contact: null, cabinet: person });
  });
  return rows;
}

/** The cabinet persons of a lead: the trusted persons and the recipients of the stored choice, once each. */
export function cabinetPeople(
  trustedPersons: readonly CabinetPerson[] | null | undefined,
  consentForm: LeadPortalConsentForm | null | undefined,
): CabinetPerson[] {
  const result: CabinetPerson[] = [];
  const seen = new Set<string>();
  for (const person of [...(trustedPersons ?? []), ...(consentForm?.recipients ?? [])]) {
    const key = personNameKey(person.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(person);
  }
  return result;
}

export type ConsentFormRecipients = {
  /** Whose list the consent form prints. */
  source: "cabinet" | "staff";
  names: string[];
};

/**
 * Who the consent form names under «an folgende Personen oder Institutionen»,
 * by the server's rule (`routes/documents.rs`): a choice stored in the cabinet
 * prints its recipients, and only while «named recipients» is ticked; without
 * a choice the staff contacts are printed, on a minor's form without the
 * parents and the guardian, who declare themselves.
 */
export function consentFormRecipients(
  consentForm: LeadPortalConsentForm | null | undefined,
  contacts: readonly StaffContact[],
  minor: boolean,
): ConsentFormRecipients {
  if (consentForm?.choices) {
    const names = consentForm.choices.named_recipients === true
      ? consentForm.recipients.map((recipient) => recipient.name.trim()).filter(Boolean)
      : [];
    return { source: "cabinet", names };
  }
  const names = contacts
    .filter((contact) => !minor || !isParentOrGuardianRelation(contact.relation))
    .map((contact) => contact.name.trim())
    .filter(Boolean);
  return { source: "staff", names };
}
