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
};

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
  }));
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
  );
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
