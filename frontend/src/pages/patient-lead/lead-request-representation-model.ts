import type {
  Custody,
  LeadRequestPersonalData,
  LeadRequestRepresentation,
  LeadRequestRepresentative,
  RepresentationPatch,
  RepresentativePatch,
  RepresentativeRole,
  RepresentativeSlot,
} from "./lead-request-api";

// Who acts for the lead (owner spec "Patientenformular", section 3): the two
// answers of an adult, the custody of a minor, and one form per person. This
// module imports types only, so that `lead-request-model` can take the keys
// of `progress.missing_for_submit` from here.

/** The persons of the form in its order: an adult's two, then a minor's two. */
export const REPRESENTATIVE_SLOTS = ["agent", "guardian", "rep1", "rep2"] as const satisfies readonly RepresentativeSlot[];

/** The role a person of a slot is created with. */
export const ROLE_OF_SLOT: Record<RepresentativeSlot, RepresentativeRole> = {
  agent: "authorised_representative",
  guardian: "legal_guardian",
  rep1: "legal_representative",
  rep2: "legal_representative",
};

/** Who represents a minor, in the order of the form. */
export const CUSTODIES = ["joint", "sole_parent", "guardian"] as const satisfies readonly Custody[];

/** The answers of the block as the patient gives them. */
export type RepresentationDraft = {
  /** An adult's answers: "yes", "no" or "" (not answered yet). */
  has_representative: string;
  under_guardianship: string;
  /** A minor's custody; both parents until somebody says otherwise. */
  custody: Custody;
};

function answerOf(value: boolean | null | undefined): string {
  return value == null ? "" : value ? "yes" : "no";
}

function booleanOf(answer: string): boolean | null {
  return answer === "yes" ? true : answer === "no" ? false : null;
}

export function draftFromRepresentation(
  representation: LeadRequestRepresentation | null | undefined,
): RepresentationDraft {
  return {
    has_representative: answerOf(representation?.has_representative),
    under_guardianship: answerOf(representation?.under_guardianship),
    custody: representation?.custody ?? "joint",
  };
}

/**
 * Only the changed answers, and only those that fit the lead's age: the
 * server refuses the custody of an adult and the two questions of a minor.
 */
export function representationPatch(
  saved: RepresentationDraft,
  draft: RepresentationDraft,
  minor: boolean,
): RepresentationPatch {
  const patch: RepresentationPatch = {};
  if (minor) {
    if (draft.custody !== saved.custody) patch.custody = draft.custody;
    return patch;
  }
  if (draft.has_representative !== saved.has_representative) {
    patch.has_representative = booleanOf(draft.has_representative);
  }
  if (draft.under_guardianship !== saved.under_guardianship) {
    patch.under_guardianship = booleanOf(draft.under_guardianship);
  }
  return patch;
}

/**
 * The persons the form asks for. An adult names one per "yes"; a minor has
 * the first representative and, with joint custody, the second.
 */
export function shownSlots(minor: boolean, draft: RepresentationDraft): RepresentativeSlot[] {
  if (minor) return draft.custody === "joint" ? ["rep1", "rep2"] : ["rep1"];
  return [
    ...(draft.has_representative === "yes" ? (["agent"] as const) : []),
    ...(draft.under_guardianship === "yes" ? (["guardian"] as const) : []),
  ];
}

export function representativeInSlot(
  representation: LeadRequestRepresentation | null | undefined,
  slot: RepresentativeSlot,
): LeadRequestRepresentative | null {
  return representation?.representatives.find((person) => person.slot === slot) ?? null;
}

/** Persons on file at GMED the form does not ask for: they are named in a note only. */
export function representativesOnFile(
  representation: LeadRequestRepresentation | null | undefined,
): LeadRequestRepresentative[] {
  return (representation?.representatives ?? []).filter((person) => person.slot === null);
}

/**
 * Whom the server removes when the answers become `next`, so that the form
 * can ask first. An adult's answer other than "yes" removes the person named
 * for it. Leaving joint custody removes everybody but the first
 * representative whom the cabinet may remove; a second parent staff entered
 * stays on file.
 */
export function removedByAnswers(
  representation: LeadRequestRepresentation | null | undefined,
  minor: boolean,
  next: RepresentationDraft,
): LeadRequestRepresentative[] {
  const persons = representation?.representatives ?? [];
  if (minor) {
    if (next.custody === "joint" || next.custody === (representation?.custody ?? "joint")) return [];
    return persons.filter((person) => person.slot !== "rep1" && person.can_remove);
  }
  return persons.filter(
    (person) =>
      (person.slot === "agent" && next.has_representative !== "yes") ||
      (person.slot === "guardian" && next.under_guardianship !== "yes"),
  );
}

/** "First Last" of a person; empty while nothing is known. */
export function representativeName(person: Pick<LeadRequestRepresentative, "first_name" | "last_name">): string {
  return [person.first_name, person.last_name]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * The id of a person the cabinet creates: the first save of the form sends it
 * (contract 5). `randomUUID` exists in secure contexts only; the fallback
 * builds the same kind of id (version 4) from random bytes.
 */
export function newRepresentativeId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The form of one person as it is typed (strings, citizenships as codes). */
export type RepresentativeDraft = {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  birth_place: string;
  birth_country: string;
  citizenships: string[];
  street: string;
  zip: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  /** "passport", "id_card", "residence_permit" or "". */
  id_document_type: string;
  id_document_number: string;
  id_issuing_authority: string;
  id_issuing_country: string;
  id_issued_on: string;
  id_valid_until: string;
};

export type RepresentativeField = keyof RepresentativeDraft;

/** The fields of a person in the order of the form. */
export const REPRESENTATIVE_FIELDS: RepresentativeField[] = [
  "first_name",
  "last_name",
  "date_of_birth",
  "birth_place",
  "birth_country",
  "citizenships",
  "street",
  "zip",
  "city",
  "country",
  "email",
  "phone",
  "id_document_type",
  "id_document_number",
  "id_issuing_authority",
  "id_issuing_country",
  "id_issued_on",
  "id_valid_until",
];

export function draftFromRepresentative(person: LeadRequestRepresentative | null | undefined): RepresentativeDraft {
  return {
    first_name: person?.first_name ?? "",
    last_name: person?.last_name ?? "",
    date_of_birth: person?.date_of_birth ?? "",
    birth_place: person?.birth_place ?? "",
    birth_country: person?.birth_country ?? "",
    citizenships: [...(person?.citizenships ?? [])],
    street: person?.street ?? "",
    zip: person?.zip ?? "",
    city: person?.city ?? "",
    country: person?.country ?? "",
    email: person?.email ?? "",
    phone: person?.phone ?? "",
    id_document_type: person?.id_document_type ?? "",
    id_document_number: person?.id_document_number ?? "",
    id_issuing_authority: person?.id_issuing_authority ?? "",
    id_issuing_country: person?.id_issuing_country ?? "",
    id_issued_on: person?.id_issued_on ?? "",
    id_valid_until: person?.id_valid_until ?? "",
  };
}

/** The comparable form of a field: what would be sent, as text. */
export function representativeValue(field: RepresentativeField, draft: RepresentativeDraft): string {
  if (field === "citizenships") return draft.citizenships.join(",");
  return draft[field].trim().replace(/\s+/g, " ");
}

/** Whether anything was typed about the person. */
export function hasRepresentativeEntries(draft: RepresentativeDraft): boolean {
  return REPRESENTATIVE_FIELDS.some((field) => representativeValue(field, draft) !== "");
}

/**
 * Whether a field is asked of a person of this slot. An adult's
 * representative or guardian is not asked for the country of birth.
 */
export function asksRepresentativeField(slot: RepresentativeSlot, field: RepresentativeField): boolean {
  return field !== "birth_country" || slot === "rep1" || slot === "rep2";
}

/** What the request cannot be sent without (contract 2.6), per kind of person. */
const ADULT_REQUIRED: ReadonlySet<RepresentativeField> = new Set([
  "first_name",
  "last_name",
  "date_of_birth",
  "street",
  "zip",
  "city",
  "country",
  "id_document_type",
  "id_document_number",
  "id_issuing_authority",
  "id_issuing_country",
  "id_valid_until",
]);

const MINOR_REQUIRED: ReadonlySet<RepresentativeField> = new Set([
  ...ADULT_REQUIRED,
  "birth_place",
  "citizenships",
  "email",
  "phone",
]);

export function requiresRepresentativeField(slot: RepresentativeSlot, field: RepresentativeField): boolean {
  return (slot === "rep1" || slot === "rep2" ? MINOR_REQUIRED : ADULT_REQUIRED).has(field);
}

/** Values the server refused, by field; none of them is sent again until it is changed. */
export type RejectedRepresentative = Partial<Record<RepresentativeField, string>>;

/**
 * What a save of a person sends: only the fields that differ from the last
 * saved state. A cleared text is sent as `""`; an empty last name is not sent
 * (a person has one), a refused value is not repeated, and a sign-in address
 * is never sent. `create` is the role of a person the server does not know
 * yet: the first save creates it, once the last name is there. `null` means
 * there is nothing to send.
 */
export function representativePatch(
  saved: RepresentativeDraft,
  draft: RepresentativeDraft,
  options: { rejected?: RejectedRepresentative; create?: RepresentativeRole | null; emailLocked?: boolean } = {},
): RepresentativePatch | null {
  const patch: RepresentativePatch = {};
  for (const field of REPRESENTATIVE_FIELDS) {
    const next = representativeValue(field, draft);
    if (next === representativeValue(field, saved)) continue;
    if (options.rejected?.[field] === next) continue;
    if (field === "last_name" && !next) continue;
    if (field === "email" && options.emailLocked) continue;
    if (field === "citizenships") patch.citizenships = [...draft.citizenships];
    else patch[field] = next;
  }
  if (options.create) {
    if (!patch.last_name) return null;
    patch.role = options.create;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * The field a refusal of the server belongs to, or `null` when it concerns
 * the person as a whole. The two refusals of an e-mail name no field.
 */
export function refusedRepresentativeField(code: string, field: unknown): RepresentativeField | null {
  if (code === "representative_email_is_login" || code === "representative_email_duplicate") return "email";
  if (typeof field !== "string") return null;
  // The key of the body; a key of the missing list ("rep2_email") names the same field.
  const key = representativeSubmitPart(field)?.part ?? field;
  return REPRESENTATIVE_FIELDS.includes(key as RepresentativeField) ? (key as RepresentativeField) : null;
}

/** Notes that the server refused the current value of `field`; other fields keep their entry. */
export function withRejectedRepresentative(
  rejected: RejectedRepresentative,
  field: RepresentativeField,
  draft: RepresentativeDraft,
): RejectedRepresentative {
  return { ...rejected, [field]: representativeValue(field, draft) };
}

/** The refusals that still apply: a value changed since may be sent again. */
export function stillRejectedRepresentative(
  rejected: RejectedRepresentative,
  draft: RepresentativeDraft,
): RejectedRepresentative {
  const next: RejectedRepresentative = {};
  for (const field of REPRESENTATIVE_FIELDS) {
    if (rejected[field] !== undefined && rejected[field] === representativeValue(field, draft)) next[field] = rejected[field];
  }
  return next;
}

/** The person's address replaced by the child's, for a parent who lives with the child. */
export function withChildAddress(
  draft: RepresentativeDraft,
  child: Pick<LeadRequestPersonalData, "street_address" | "zip_code" | "city" | "country">,
): RepresentativeDraft {
  return {
    ...draft,
    street: child.street_address ?? "",
    zip: child.zip_code ?? "",
    city: child.city ?? "",
    country: child.country ?? "",
  };
}

/** Whether the child's address is known, so that it can be taken over. */
export function hasChildAddress(
  child: Pick<LeadRequestPersonalData, "street_address" | "zip_code" | "city" | "country">,
): boolean {
  return [child.street_address, child.zip_code, child.city, child.country].some((value) => Boolean(value?.trim()));
}

/** What proves that a person may act for the lead. */
export type AuthorityProof = "power_of_attorney" | "guardianship_certificate" | "appointment_certificate" | "sole_custody";

/**
 * The proof of authority a person is asked for, and whether the request needs
 * it. A minor's guardian shows the certificate of appointment; a parent with
 * sole custody may show the proof of it; with joint custody nothing is asked.
 */
export function authorityProofOf(
  slot: RepresentativeSlot,
  custody: Custody | null | undefined,
): { proof: AuthorityProof; required: boolean } | null {
  if (slot === "agent") return { proof: "power_of_attorney", required: true };
  if (slot === "guardian") return { proof: "guardianship_certificate", required: true };
  if (slot === "rep1" && custody === "guardian") return { proof: "appointment_certificate", required: true };
  if (slot === "rep1" && custody === "sole_parent") return { proof: "sole_custody", required: false };
  return null;
}

/** What `progress.missing_for_submit` names about a person: a field or one of the two uploads. */
export type RepresentativeSubmitPart = RepresentativeField | "id_upload" | "authority_upload";

/** Keys of the block in `progress.missing_for_submit`: the answers, and `<slot>_<part>` per person. */
export type RepresentationSubmitField =
  | "has_representative"
  | "under_guardianship"
  | `${RepresentativeSlot}_${RepresentativeSubmitPart}`;

/** The keys of one person in form order: the required fields, then the uploads. */
function slotSubmitFields(slot: RepresentativeSlot): RepresentationSubmitField[] {
  return [
    ...REPRESENTATIVE_FIELDS.filter((field) => requiresRepresentativeField(slot, field)).map(
      (field): RepresentationSubmitField => `${slot}_${field}`,
    ),
    `${slot}_id_upload`,
    // The second representative of a minor is a parent: no proof is asked.
    ...(slot === "rep2" ? [] : ([`${slot}_authority_upload`] as const)),
  ];
}

/** Everything the server can name as missing about the representation, in the order of the form. */
export const REPRESENTATION_SUBMIT_FIELDS: RepresentationSubmitField[] = [
  "has_representative",
  ...slotSubmitFields("agent"),
  "under_guardianship",
  ...slotSubmitFields("guardian"),
  ...slotSubmitFields("rep1"),
  ...slotSubmitFields("rep2"),
];

/** The person and the part a key `<slot>_<part>` of the missing list names. */
export function representativeSubmitPart(
  field: string,
): { slot: RepresentativeSlot; part: RepresentativeSubmitPart } | null {
  for (const slot of REPRESENTATIVE_SLOTS) {
    if (!field.startsWith(`${slot}_`)) continue;
    const part = field.slice(slot.length + 1);
    if (part === "id_upload" || part === "authority_upload" || REPRESENTATIVE_FIELDS.includes(part as RepresentativeField)) {
      return { slot, part: part as RepresentativeSubmitPart };
    }
  }
  return null;
}
