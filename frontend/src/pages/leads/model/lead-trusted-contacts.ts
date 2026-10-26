/**
 * Trusted contacts of a lead in the staff wizard, and who may overwrite them.
 *
 * The contacts are one array on the lead (`trusted_contacts`), written by two
 * sides: staff in the wizard, and the lead cabinet, where a parent adds the
 * second parent or corrects a name. A wizard tab that was opened earlier holds
 * an older array; if every save sent it, the save would drop the second
 * parent again. So a save sends the contacts only when staff changed them
 * since they were loaded, and a change made in the cabinet replaces the
 * contacts staff did not edit.
 */

import { isValidEmailAddress } from "@/lib/contact-validation";
import { isAdultOn } from "@/lib/person-fields";

import type { ContactEmailLoginOwner } from "../data/leads-api";

/** The relations the wizard offers for a trusted contact, in the order of its list. */
export const TRUSTED_CONTACT_RELATIONS = ["mother", "father", "guardian", "representative", "spouse", "relative", "other"] as const;

/**
 * The kind of a stored relation, read as the server reads it
 * (`normalized_patient_relation_type` in `crates/server/src/routes/leads.rs`):
 * free text of older data ("Elternteil", "Vormund", "мама", "опекун") counts
 * by the word it contains, in the server's order.
 */
function relationKind(relation: string): "spouse" | "mother" | "father" | "parent" | "child" | "sibling" | "guardian" | "other" {
  const value = relation.trim().toLowerCase();
  const has = (...parts: string[]) => parts.some((part) => value.includes(part));
  if (has("spouse", "partner", "ehe", "супруг", "чолов", "друж")) return "spouse";
  if (has("mother", "mutter", "мать", "мам", "мати")) return "mother";
  if (has("father", "vater", "отец", "пап", "батьк")) return "father";
  if (has("parent", "eltern", "родител", "бать")) return "parent";
  if (has("child", "son", "daughter", "kind", "сын", "доч", "син")) return "child";
  if (has("sibling", "brother", "sister", "bruder", "schwester", "брат", "сестр")) return "sibling";
  if (has("guardian", "vormund", "опек", "піклув")) return "guardian";
  return "other";
}

/**
 * Whether a contact is a parent or guardian, the same rule the server uses
 * for a minor's representatives (audit 2026-10-20: with an exact list a
 * contact "Vormund" or "Elternteil" was a representative on the server while
 * the wizard showed "Представитель не указан" and refused to save the minor).
 */
export function isParentOrGuardianRelation(relation: string): boolean {
  return ["mother", "father", "parent", "guardian"].includes(relationKind(relation));
}

/** A guardian (Vormund) rather than a parent, as the server reads the relation. */
export function isLegalGuardianRelation(relation: string): boolean {
  return relationKind(relation) === "guardian";
}

/**
 * How a trusted contact is related to the client, as staff read it. A stored
 * value the list does not know (free text of older data) is shown as it is.
 */
export function trustedContactRelationLabel(relation: string, tx: (ru: string, de: string) => string): string {
  switch (relation.trim().toLowerCase()) {
    case "mother":
    case "mutter":
    case "мать":
    case "мати":
      return tx("Мать", "Mutter");
    case "father":
    case "vater":
    case "отец":
    case "батько":
      return tx("Отец", "Vater");
    case "parent":
      return tx("Родитель — роль не уточнена", "Elternteil — Rolle nicht angegeben");
    case "guardian":
      // A minor's Vormund or an adult's Betreuer (rechtliche Betreuung).
      return tx("Опекун", "Vormund/Betreuer");
    case "representative":
      return tx("Уполномоченный представитель", "Bevollmächtigte Person");
    case "spouse":
      return tx("Супруг / супруга", "Ehepartner/in");
    case "relative":
      return tx("Родственник", "Verwandte Person");
    case "other":
      return tx("Другое", "Sonstiges");
    default:
      return relation;
  }
}

/**
 * The option of the relation list in the editor. A parent must not end up as
 * "Опекун": the documents then call the father a Vormund (Linda, 2026-10-22).
 * So the guardian option says that a court appointed the person, and in the
 * block of a minor's parents the parents' options say they are parents.
 */
export function guardianRelationOptionLabel(
  relation: string,
  tx: (ru: string, de: string) => string,
  minor = true,
): string {
  switch (relation) {
    case "mother":
      return minor ? tx("Мать (родитель)", "Mutter (Elternteil)") : tx("Мать", "Mutter");
    case "father":
      return minor ? tx("Отец (родитель)", "Vater (Elternteil)") : tx("Отец", "Vater");
    case "guardian":
      return minor
        ? tx("Опекун по решению суда (не родитель)", "Vormund, vom Gericht bestellt (kein Elternteil)")
        : tx("Опекун / Betreuer по решению суда", "Betreuer/in, vom Gericht bestellt");
    case "representative":
      return tx("Уполномоченный по доверенности", "Bevollmächtigte Person (Vollmacht)");
    default:
      return trustedContactRelationLabel(relation, tx);
  }
}

/** A parent, guardian or authorised representative: they act for the lead. */
function actsForLead(relation: string): boolean {
  return isParentOrGuardianRelation(relation) || relation.trim().toLowerCase() === "representative";
}

/**
 * Whether staff save a parent, guardian or representative born less than 18
 * years ago (owner 2026-10-24: of full age, as in the cabinet; the server's
 * `TrustedContactIssue::MinorRepresentative`). Checked only when the date or
 * the role is new or changed, so a stored entry keeps saving.
 */
export function representativeMinorOnSave(
  contact: Pick<TrustedContactDraft, "relation" | "birthDate">,
  stored: Pick<TrustedContactDraft, "relation" | "birthDate"> | undefined,
  today: string,
): boolean {
  const birthDate = contact.birthDate.trim();
  if (!birthDate || !actsForLead(contact.relation)) return false;
  const changed = !stored || stored.birthDate.trim() !== birthDate || actsForLead(stored.relation) !== actsForLead(contact.relation);
  return changed && !isAdultOn(birthDate, today);
}

/**
 * Whether an e-mail address is new or changed in this edit (case and
 * whitespace do not count), as the server judges it
 * (`email_address::no_mail_domain_of_change`): only such an address is judged
 * by its domain. A stored address whose domain the browser rates "no_mail"
 * never blocks saving another field (QA 2026-10-24, B-1a: the phone change
 * of a parent was lost).
 */
export function emailChangedOnSave(next: string, stored: string | null | undefined): boolean {
  const nextValue = next.trim().toLowerCase();
  if (!nextValue) return false;
  return nextValue !== (stored ?? "").trim().toLowerCase();
}

/** The address parts a representative stated in the cabinet (`lead_representatives`). */
export type RepresentativeAddressParts = {
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
};

/**
 * The address a representative stated in the cabinet, as one line, or null
 * without one. The GwG sheet and the consent form print these parts, not the
 * one-line address of the trusted contact: while they exist, staff do not
 * edit that line in the wizard (a change there reached no document).
 */
export function representativeCabinetAddress(
  person: RepresentativeAddressParts | null | undefined,
  countryName: (code: string) => string,
): string | null {
  if (!person) return null;
  const clean = (value: string | null) => (value ?? "").trim();
  const locality = [clean(person.zip), clean(person.city)].filter(Boolean).join(" ");
  const country = clean(person.country);
  const line = [clean(person.street), locality, country ? countryName(country) : ""].filter(Boolean).join(", ");
  return line || null;
}

/** A trusted contact as the wizard edits it. */
export type TrustedContactDraft = {
  id: string;
  relatedPatientId: string;
  relatedPatientLabel: string;
  name: string;
  phone: string;
  email: string;
  relation: string;
  birthDate: string;
  address: string;
  /**
   * A representative's citizenships and birth data staff changed in the
   * contact dialog: sent with the contact by the wizard save (F-11, QA
   * 2026-10-25), only the keys staff changed. The address parts stay on
   * `PUT …/representatives/{id}/details`.
   */
  representativeDetails?: TrustedContactRepresentativeDetails;
};

/** The representative keys a contact carries in the wizard save (`TrustedContactRequest` on the server). */
export type TrustedContactRepresentativeDetails = {
  citizenships?: string[];
  birth_place?: string | null;
  birth_country?: string | null;
};

/** A trusted contact as `POST /leads/{id}/update` takes it. */
export type TrustedContactPayload = {
  id: string;
  related_patient_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  relation: string | null;
  birth_date: string | null;
  address: string | null;
} & TrustedContactRepresentativeDetails;

export function trustedContactsPayload(contacts: readonly TrustedContactDraft[]): TrustedContactPayload[] {
  return contacts.map((contact) => ({
    id: contact.id,
    related_patient_id: contact.relatedPatientId || null,
    name: contact.name.trim(),
    phone: contact.phone.trim() || null,
    email: contact.email.trim() || null,
    relation: contact.relation.trim() || null,
    birth_date: contact.birthDate || null,
    address: contact.address.trim() || null,
    ...representativeDetailsPayload(contact.representativeDetails),
  }));
}

/** Only the keys staff changed; a cleared text is `null` (the server clears it then). */
function representativeDetailsPayload(details: TrustedContactRepresentativeDetails | undefined): TrustedContactRepresentativeDetails {
  if (!details) return {};
  const result: TrustedContactRepresentativeDetails = {};
  if (details.citizenships !== undefined) result.citizenships = [...details.citizenships];
  if (details.birth_place !== undefined) result.birth_place = details.birth_place?.trim() || null;
  if (details.birth_country !== undefined) result.birth_country = details.birth_country?.trim().toUpperCase() || null;
  return result;
}

/**
 * The representative keys of the contact dialog that staff changed against
 * what the dialog loaded (`undefined` when none): the citizenships and the
 * birth data, never the address parts.
 */
export function changedRepresentativeDetails(
  draft: { citizenships: readonly string[]; birth_place: string; birth_country: string },
  loaded: { citizenships: readonly string[]; birth_place: string; birth_country: string },
): TrustedContactRepresentativeDetails | undefined {
  const codes = (values: readonly string[]) => values.map((value) => value.trim().toUpperCase()).filter(Boolean);
  const text = (value: string) => value.trim().split(/\s+/).join(" ");
  const result: TrustedContactRepresentativeDetails = {};
  if (codes(draft.citizenships).join() !== codes(loaded.citizenships).join()) result.citizenships = codes(draft.citizenships);
  if (text(draft.birth_place) !== text(loaded.birth_place)) result.birth_place = text(draft.birth_place) || null;
  if (draft.birth_country.trim().toUpperCase() !== loaded.birth_country.trim().toUpperCase()) {
    result.birth_country = draft.birth_country.trim().toUpperCase() || null;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * The contacts of a freshly loaded draft that the server stores under their
 * own id. A contact read from the older single-contact fields, or stored
 * without an id, got its id in the browser: it counts as not stored yet, so
 * the next save writes it (as every save did before).
 */
export function storedTrustedContactDrafts<T extends TrustedContactDraft>(
  stored: ReadonlyArray<{ id?: string | null }> | null | undefined,
  loaded: readonly T[],
): T[] {
  const ids = new Set((Array.isArray(stored) ? stored : []).flatMap((contact) => (contact?.id ? [contact.id] : [])));
  return loaded.filter((contact) => ids.has(contact.id));
}

function sameContact(left: TrustedContactPayload, right: TrustedContactPayload): boolean {
  return (
    left.id === right.id
    && left.related_patient_id === right.related_patient_id
    && left.name === right.name
    && left.phone === right.phone
    && left.email === right.email
    && left.relation === right.relation
    && left.birth_date === right.birth_date
    && left.address === right.address
    && REPRESENTATIVE_DETAIL_KEYS.every((key) => sentDetail(left, key) === sentDetail(right, key))
  );
}

const REPRESENTATIVE_DETAIL_KEYS = ["citizenships", "birth_place", "birth_country"] as const;

/** A representative key as sent: left out differs from a cleared `null`. */
function sentDetail(contact: TrustedContactPayload, key: (typeof REPRESENTATIVE_DETAIL_KEYS)[number]): string {
  return key in contact && contact[key] !== undefined ? JSON.stringify(contact[key]) : "-";
}

/**
 * Whether staff changed the contacts since they were loaded: one was added,
 * removed or edited. `stored` is what the server has as far as the wizard
 * knows (the loaded contacts, or the ones of the last save that sent them).
 */
export function trustedContactsChanged(
  current: readonly TrustedContactPayload[],
  stored: readonly TrustedContactPayload[],
): boolean {
  return current.length !== stored.length || current.some((contact, index) => !sameContact(contact, stored[index]));
}

/** A lead update without the contacts: the server then keeps the ones it has. */
export function withoutTrustedContacts<T extends Record<string, unknown>>(payload: T): Omit<T, "trusted_contacts"> {
  const rest: Record<string, unknown> = { ...payload };
  delete rest.trusted_contacts;
  return rest as Omit<T, "trusted_contacts">;
}

/**
 * The body of a wizard save: with the contacts only when staff changed them.
 * `stored` is what the server has as far as the wizard knows: the contacts it
 * loaded or took over from the cabinet, or — once a save carried contacts —
 * the list of that save. `contacts` is the list that goes out, null when none
 * does. `stored` goes with it as `trusted_contacts_base`: what staff left as
 * loaded keeps the server's value, so a parent's change in the cabinet since
 * the load is not reverted by this save.
 */
export function leadUpdateWithChangedContacts<T extends Record<string, unknown>>(
  payload: T,
  draftContacts: readonly TrustedContactDraft[],
  stored: readonly TrustedContactPayload[],
): { body: T | Omit<T, "trusted_contacts">; contacts: TrustedContactPayload[] | null } {
  const contacts = trustedContactsPayload(draftContacts);
  return trustedContactsChanged(contacts, stored)
    ? { body: { ...payload, trusted_contacts: contacts, trusted_contacts_base: [...stored] }, contacts }
    : { body: withoutTrustedContacts(payload), contacts: null };
}

/**
 * Takes the contacts of a fresh lead into the open wizard draft after the
 * lead or a parent changed them in the cabinet. A contact staff did not edit
 * since the last load takes the fresh values; one staff edited or added stays
 * as it is; one staff removed stays removed; a new one appears; one that is
 * gone on the server and untouched here disappears. The order follows the
 * server, with the contacts only this wizard knows at the end.
 */
export function mergeTrustedContacts<T extends TrustedContactDraft>(
  current: readonly T[],
  stored: readonly TrustedContactPayload[],
  fresh: readonly T[],
): T[] {
  const storedById = new Map(stored.map((contact) => [contact.id, contact]));
  const currentById = new Map(current.map((contact) => [contact.id, contact]));
  const freshIds = new Set(fresh.map((contact) => contact.id));
  const editedByStaff = (contact: T) => {
    const base = storedById.get(contact.id);
    return !base || !sameContact(trustedContactsPayload([contact])[0], base);
  };

  const merged: T[] = [];
  for (const contact of fresh) {
    const mine = currentById.get(contact.id);
    if (mine) merged.push(editedByStaff(mine) ? mine : contact);
    else if (!storedById.has(contact.id)) merged.push(contact);
  }
  for (const contact of current) {
    if (!freshIds.has(contact.id) && editedByStaff(contact)) merged.push(contact);
  }
  return merged;
}

/** How long the contact editor waits after the last keystroke before it asks whose login an address is. */
export const CONTACT_EMAIL_CHECK_DEBOUNCE_MS = 400;

/**
 * The address the contact editor asks the server about (DEV QA V-A6), or
 * null: only a well-formed address that differs from the stored one, so
 * opening a saved contact sends no request.
 */
export function contactEmailToCheck(email: string, storedEmail?: string | null): string | null {
  const value = email.trim();
  if (!value || !isValidEmailAddress(value)) return null;
  if (storedEmail && storedEmail.trim().toLowerCase() === value.toLowerCase()) return null;
  return value;
}

/**
 * The non-blocking warning under the e-mail field when the address is the
 * login of another person; saving stays allowed.
 */
export function contactEmailLoginWarning(
  owner: ContactEmailLoginOwner | null,
  tx: (ru: string, de: string) => string,
): string | null {
  if (!owner) return null;
  if (owner.kind === "staff") {
    return tx(
      "Этот адрес — логин сотрудника GMED. Проверьте адрес.",
      "Diese Adresse ist der Login eines GMED-Mitarbeiters. Bitte prüfen.",
    );
  }
  const who = [owner.patient_number, owner.display_name].filter(Boolean).join(", ");
  const suffix = who ? ` (${who})` : "";
  if (owner.kind === "patient") {
    return tx(
      `Этот адрес — логин другого пациента${suffix}. Проверьте, тот ли это человек.`,
      `Diese Adresse ist der Login einer anderen Person${suffix}. Bitte prüfen.`,
    );
  }
  return tx(
    `Этот адрес — логин другого человека${suffix}. Проверьте, тот ли это человек.`,
    `Diese Adresse ist der Login einer anderen Person${suffix}. Bitte prüfen.`,
  );
}

/**
 * Debounced "whose login is this address" lookup of the contact editor:
 * every `update` clears the shown warning at once, and only the answer for
 * the latest address arrives; a failed lookup shows nothing (the warning is
 * advice, never a gate).
 */
export function createContactEmailLoginCheck(
  lookup: (email: string) => Promise<ContactEmailLoginOwner | null>,
  onOwner: (owner: ContactEmailLoginOwner | null) => void,
  delayMs = CONTACT_EMAIL_CHECK_DEBOUNCE_MS,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  const stop = () => {
    generation += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    update(email: string, storedEmail?: string | null) {
      stop();
      onOwner(null);
      const target = contactEmailToCheck(email, storedEmail);
      if (!target) return;
      const mine = generation;
      timer = setTimeout(() => {
        timer = null;
        lookup(target).then(
          (owner) => { if (mine === generation) onOwner(owner); },
          () => { if (mine === generation) onOwner(null); },
        );
      }, delayMs);
    },
    cancel: stop,
  };
}
