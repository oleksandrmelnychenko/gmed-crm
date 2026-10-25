import type { LeadPrefilledFromSource, LeadSourcePerson, LeadTrustedContact } from "@/lib/api/types";

type Tx = (ru: string, de: string) => string;

export type { LeadSourcePerson };

/**
 * «Новая заявка для этой особы» (owner 2026-10-25): a parent, guardian or other
 * relation recorded on a patient (or a trusted contact of an open lead) becomes
 * a lead of their own. The leads page opens its create-mode wizard from these
 * query parameters, so the button works from the patient card, from a wizard
 * on another lead and from a pasted link alike.
 */
const NEW_PARAM = "new";
const NEW_PERSON = "person";
const PARAMS = {
  patient: "source_patient",
  relation: "source_relation",
  lead: "source_lead",
  contact: "source_contact",
} as const;

export const LEAD_SOURCE_PERSON_PARAMS: readonly string[] = [NEW_PARAM, ...Object.values(PARAMS)];

export function newRequestForPersonHref(source: LeadSourcePerson): string {
  const params = new URLSearchParams({ [NEW_PARAM]: NEW_PERSON });
  if ("patient_id" in source) {
    params.set(PARAMS.patient, source.patient_id);
    params.set(PARAMS.relation, source.relation_id);
  } else {
    params.set(PARAMS.lead, source.lead_id);
    params.set(PARAMS.contact, source.contact_id);
  }
  return `/leads?${params.toString()}`;
}

export function leadSourcePersonFromSearchParams(params: URLSearchParams): LeadSourcePerson | null {
  if (params.get(NEW_PARAM) !== NEW_PERSON) return null;
  const patientId = params.get(PARAMS.patient)?.trim();
  const relationId = params.get(PARAMS.relation)?.trim();
  if (patientId && relationId) return { patient_id: patientId, relation_id: relationId };
  const leadId = params.get(PARAMS.lead)?.trim();
  const contactId = params.get(PARAMS.contact)?.trim();
  if (leadId && contactId) return { lead_id: leadId, contact_id: contactId };
  return null;
}

/** The same request without the source parameters (they are consumed once). */
export function withoutLeadSourcePersonParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of LEAD_SOURCE_PERSON_PARAMS) next.delete(key);
  return next;
}

/** A contact's name in one field, as the server splits it: the last word is the last name. */
export function splitPersonName(name: string | null | undefined): { firstName: string; lastName: string } {
  const words = (name ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return { firstName: "", lastName: "" };
  if (words.length === 1) return { firstName: "", lastName: words[0] };
  return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1] };
}

/** The identity the frontend already holds about the person; the server merges the rest. */
export type SourcePersonSeed = {
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  email?: string;
  phone?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
};

type RelationLike = {
  related_name: string;
  phone?: string | null;
  email?: string | null;
  address_street?: string | null;
  address_zip?: string | null;
  address_city?: string | null;
  address_country?: string | null;
};

export function seedFromPatientRelation(relation: RelationLike): SourcePersonSeed {
  return {
    ...splitPersonName(relation.related_name),
    phone: relation.phone?.trim() ?? "",
    email: relation.email?.trim() ?? "",
    street: relation.address_street?.trim() ?? "",
    zip: relation.address_zip?.trim() ?? "",
    city: relation.address_city?.trim() ?? "",
    country: relation.address_country?.trim() ?? "",
  };
}

export function seedFromTrustedContact(
  contact: Pick<LeadTrustedContact, "name" | "phone" | "email" | "birth_date">,
): SourcePersonSeed {
  return {
    ...splitPersonName(contact.name),
    phone: contact.phone?.trim() ?? "",
    email: contact.email?.trim() ?? "",
    birthDate: contact.birth_date?.trim() ?? "",
  };
}

type IdentityDraft = {
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  phone: string;
  street: string;
  zip: string;
  city: string;
  country: string;
};

/** Only empty fields take the seed: what staff typed meanwhile stays. */
export function fillMissingFromSeed<Draft extends IdentityDraft>(draft: Draft, seed: SourcePersonSeed): Draft {
  const pick = (current: string, next: string | undefined) => (current.trim() ? current : next?.trim() ?? "");
  return {
    ...draft,
    firstName: pick(draft.firstName, seed.firstName),
    lastName: pick(draft.lastName, seed.lastName),
    birthDate: pick(draft.birthDate, seed.birthDate),
    email: pick(draft.email, seed.email),
    phone: pick(draft.phone, seed.phone),
    street: pick(draft.street, seed.street),
    zip: pick(draft.zip, seed.zip),
    city: pick(draft.city, seed.city),
    country: pick(draft.country, seed.country),
  };
}

type IdentityProfile = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

/**
 * After `POST /leads` the server holds what it copied from the source; the
 * wizard's next update sends every identity field, so the empty ones take the
 * stored values first (the basics go through `fillMissingParentProfile`).
 */
export function fillMissingIdentityNames<Draft extends Pick<IdentityDraft, "firstName" | "lastName" | "email">>(
  draft: Draft,
  profile: IdentityProfile,
): Draft {
  return {
    ...draft,
    firstName: draft.firstName.trim() ? draft.firstName : profile.first_name?.trim() ?? "",
    lastName: draft.lastName.trim() ? draft.lastName : profile.last_name?.trim() ?? "",
    email: draft.email.trim() ? draft.email : profile.email?.trim() ?? "",
  };
}

const ID_DOCUMENT_PREFIX = "id_";

/** One label per copied field, in the server's order; the identity-document columns collapse into one. */
export function prefilledFieldLabels(fields: readonly string[], tx: Tx): string[] {
  const labels: Record<string, string> = {
    first_name: tx("имя", "Vorname"),
    last_name: tx("фамилия", "Nachname"),
    date_of_birth: tx("дата рождения", "Geburtsdatum"),
    phone: tx("телефон", "Telefon"),
    email: tx("e-mail", "E-Mail"),
    street_address: tx("улица", "Straße"),
    zip_code: tx("индекс", "PLZ"),
    city: tx("город", "Ort"),
    country: tx("страна", "Land"),
    citizenships: tx("гражданство", "Staatsangehörigkeit"),
    birth_place: tx("место рождения", "Geburtsort"),
    birth_country: tx("страна рождения", "Geburtsland"),
  };
  const idDocument = tx("данные документа", "Ausweisdaten");
  const seen = new Set<string>();
  const result: string[] = [];
  for (const field of fields) {
    const label = field.startsWith(ID_DOCUMENT_PREFIX) ? idDocument : labels[field] ?? field;
    if (seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }
  return result;
}

/** «Данные заполнены из записи <child>: имя, дата рождения, …» — null when nothing was copied. */
export function prefilledFromSourceNotice(
  prefilled: LeadPrefilledFromSource | null | undefined,
  sourceName: string | null | undefined,
  tx: Tx,
): string | null {
  if (!prefilled?.fields?.length) return null;
  const list = prefilledFieldLabels(prefilled.fields, tx).join(", ");
  const name = sourceName?.trim();
  const head = name
    ? tx(`Данные заполнены из записи ${name}`, `Daten aus der Akte von ${name} übernommen`)
    : tx("Данные заполнены из связанной записи", "Daten aus der verknüpften Akte übernommen");
  return `${head}: ${list}`;
}

/** The child's questionnaire named the person as a PEP: a hint to ask again, never an answer. */
export function sourcePepHint(prefilled: LeadPrefilledFromSource | null | undefined): boolean {
  return prefilled?.hints?.pep_self === "yes";
}

export function sourcePepHintText(tx: Tx): string {
  return tx(
    "В анкете ребёнка указан статус PEP — спросить снова",
    "Im Fragebogen des Kindes ist ein PEP-Status angegeben – erneut fragen",
  );
}

export function newRequestForPersonLabel(tx: Tx): string {
  return tx("Новая заявка для этого человека", "Neue Anfrage für diese Person");
}
