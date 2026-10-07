import { cachedLanguageDisplayNames } from "@/lib/intl-cache";

import type {
  IdentificationPatch,
  LeadRequest,
  LeadRequestIdentification,
  LeadRequestPayer,
  LeadRequestPayerInput,
  LeadRequestPersonalData,
  PayerSelfTemplate,
  PayerType,
  PersonalDataPatch,
} from "./lead-request-api";
import { BILLING_SUBMIT_FIELDS, type BillingSubmitField } from "./lead-request-billing-model";
import { REPRESENTATION_SUBMIT_FIELDS, type RepresentationSubmitField } from "./lead-request-representation-model";

/** The step-1 form as the patient types it (strings, citizenships as codes). */
export type PersonalDraft = {
  first_name: string;
  middle_name: string;
  last_name: string;
  date_of_birth: string;
  legal_sex: string;
  citizenships: string[];
  street_address: string;
  zip_code: string;
  city: string;
  country: string;
  phone: string;
  primary_language: string;
  /** "yes", "no" or "" (not stated). */
  has_insurance: string;
  insurance_type: string;
  insurance_provider: string;
  insurance_number: string;
  insurance_covers_germany: string;
};

export type PersonalField = keyof PersonalDraft;

export const PERSONAL_FIELDS: PersonalField[] = [
  "first_name",
  "middle_name",
  "last_name",
  "date_of_birth",
  "legal_sex",
  "citizenships",
  "street_address",
  "zip_code",
  "city",
  "country",
  "phone",
  "primary_language",
  "has_insurance",
  "insurance_type",
  "insurance_provider",
  "insurance_number",
  "insurance_covers_germany",
];

export function draftFromPersonalData(data: LeadRequestPersonalData): PersonalDraft {
  return {
    first_name: data.first_name ?? "",
    middle_name: data.middle_name ?? "",
    last_name: data.last_name ?? "",
    date_of_birth: data.date_of_birth ?? "",
    legal_sex: data.legal_sex ?? "",
    citizenships: [...(data.citizenships ?? [])],
    street_address: data.street_address ?? "",
    zip_code: data.zip_code ?? "",
    city: data.city ?? "",
    country: data.country ?? "",
    phone: data.phone ?? "",
    primary_language: data.primary_language ?? "",
    has_insurance: data.has_insurance == null ? "" : data.has_insurance ? "yes" : "no",
    insurance_type: data.insurance_type ?? "",
    insurance_provider: data.insurance_provider ?? "",
    insurance_number: data.insurance_number ?? "",
    insurance_covers_germany: data.insurance_covers_germany ?? "",
  };
}

/**
 * The draft after the answer "is there an insurance?". "No" means self-payer,
 * as in the staff wizard: the details of an insurance go (the server does the
 * same). An insured person is never the self-payer type.
 */
export function withInsuranceAnswer(draft: PersonalDraft, answer: string): PersonalDraft {
  if (answer === "no") {
    return {
      ...draft,
      has_insurance: "no",
      insurance_type: "self_pay",
      insurance_provider: "",
      insurance_number: "",
      insurance_covers_germany: "",
    };
  }
  return {
    ...draft,
    has_insurance: answer,
    insurance_type: draft.insurance_type === "self_pay" ? "" : draft.insurance_type,
  };
}

function normalized(field: PersonalField, draft: PersonalDraft): string {
  const value = draft[field];
  return Array.isArray(value) ? value.join(",") : value.trim().replace(/\s+/g, " ");
}

/** A value the server refused; it is not sent again until the patient changes it. */
export type RejectedValue = { field: PersonalField; value: string };

/**
 * Only the fields that differ from the last saved state, so a concurrent edit
 * by staff to another field is not overwritten. Empty names are not sent
 * (both are required) and a refused value is not repeated.
 */
export function personalDataPatch(
  saved: PersonalDraft,
  draft: PersonalDraft,
  rejected: RejectedValue | null = null,
): PersonalDataPatch {
  const patch: PersonalDataPatch = {};
  for (const field of PERSONAL_FIELDS) {
    const next = normalized(field, draft);
    if (next === normalized(field, saved)) continue;
    if ((field === "first_name" || field === "last_name") && !next) continue;
    if (rejected && rejected.field === field && rejected.value === next) continue;
    patch[field] = field === "citizenships" ? [...draft.citizenships] : next;
  }
  return patch;
}

export function rejectedValue(field: string, draft: PersonalDraft): RejectedValue | null {
  if (!PERSONAL_FIELDS.includes(field as PersonalField)) return null;
  return { field: field as PersonalField, value: normalized(field as PersonalField, draft) };
}

/** What a third-party payer can be, in the order of the form. */
export const PAYER_TYPES = ["person", "company", "organisation", "insurance"] as const satisfies readonly PayerType[];

/** A payer that is not a natural person. */
export type OrganisationPayerType = Exclude<PayerType, "person">;

/** How the payer is related to the patient, in the order of the form; `other` asks for a text. */
export const RELATIONSHIP_KINDS = [
  "spouse",
  "parent",
  "child",
  "sibling",
  "grandparent",
  "relative",
  "employer",
  "friend",
  "business_partner",
  "other",
] as const;

export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

/**
 * The first answer of the block as the form offers it. A parent's login with
 * its own data on file gets the third answer "I pay (as a parent)", which is
 * stored as a third party: a person, the patient's parent.
 */
export type PayerAnswer = "" | "self" | "guardian" | "third_party";

/** The "who pays" block as the patient types it. */
export type PayerDraft = {
  /** "self", "third_party" or "" (not answered yet). */
  payer_kind: string;
  /** A parent's answer "I pay": the payer named below is the parent, not another person. */
  guardian_pays: boolean;
  /** "person", "company", "organisation" or "insurance"; "" counts as a person, as on the server. */
  payer_type: string;
  /** Name of the company, organisation or insurer. */
  organisation_name: string;
  /** The organisation mask: legal form, register number and contact person. */
  organisation_legal_form: string;
  organisation_register_number: string;
  organisation_contact_name: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  citizenships: string[];
  /** One of `RELATIONSHIP_KINDS` or "" (not chosen yet). */
  relationship_kind: string;
  /** The relationship in words; asked with the kind "other". */
  relationship: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  /** WhatsApp / messenger number (optional). */
  messenger: string;
  /** The lead agrees that GMED contacts the payer and tells them the lead's name. */
  contact_consent: boolean;
  /** Own economic interest: "yes", "no" or "" (not answered yet). */
  acts_on_own_account: string;
  /** In whose interest the patient acts; asked with the answer "no". */
  beneficial_owner: string;
};

/** Keys of the payer block in `progress.missing_for_submit` and in field errors. */
export type PayerField =
  | "payer_kind"
  | "payer_type"
  | "payer_organisation_name"
  | "payer_legal_form"
  | "payer_register_number"
  | "payer_contact_name"
  | "payer_email_or_phone"
  | "payer_first_name"
  | "payer_last_name"
  | "payer_date_of_birth"
  | "payer_citizenships"
  | "payer_relationship_kind"
  | "payer_relationship"
  | "payer_street"
  | "payer_zip"
  | "payer_city"
  | "payer_country"
  | "payer_phone"
  | "payer_email"
  | "payer_messenger"
  | "payer_contact_consent"
  | "payer_cost_estimate_consent"
  | "payer_own_account"
  | "payer_beneficial_owner";

export const PAYER_FIELDS: PayerField[] = [
  "payer_kind",
  "payer_type",
  "payer_organisation_name",
  "payer_legal_form",
  "payer_register_number",
  "payer_contact_name",
  "payer_email_or_phone",
  "payer_first_name",
  "payer_last_name",
  "payer_date_of_birth",
  "payer_citizenships",
  "payer_relationship_kind",
  "payer_relationship",
  "payer_street",
  "payer_zip",
  "payer_city",
  "payer_country",
  "payer_phone",
  "payer_email",
  "payer_messenger",
  "payer_contact_consent",
  "payer_cost_estimate_consent",
  "payer_own_account",
  "payer_beneficial_owner",
];

/** A stored yes/no answer as the value of its select: "yes", "no" or "". */
export function answerFromBoolean(value: boolean | null | undefined): string {
  return value == null ? "" : value ? "yes" : "no";
}

function booleanFromAnswer(answer: string): boolean | null {
  return answer === "yes" ? true : answer === "no" ? false : null;
}

/** A one-line text as it is sent and compared: trimmed, runs of spaces as one. */
function oneLine(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

/**
 * Whether the server knows the payer type, the relationship list and the
 * consent to contact the payer. An answered question shows it by its keys;
 * before that, the template key does, which every such server sends. An older
 * server refuses keys it does not know, so the cabinet then asks as before.
 */
export function knowsPayerType(request: Pick<LeadRequest, "payer" | "payer_self_template">): boolean {
  return request.payer ? request.payer.payer_type !== undefined : request.payer_self_template !== undefined;
}

/**
 * Whether the server knows the organisation mask (legal form, register
 * number, contact person; trigger flow 2026-10-07): a stored payer carries
 * its keys; before that, the follow-up object shows a server of that kind.
 */
export function knowsOrganisationMask(request: Pick<LeadRequest, "payer" | "follow_up">): boolean {
  if (request.payer) return request.payer.organisation_legal_form !== undefined;
  return request.follow_up !== undefined;
}

/** The kind of organisation that pays; `null` for a natural person, also while the type is not stated. */
export function organisationPayerType(type: string | null | undefined): OrganisationPayerType | null {
  return type === "company" || type === "organisation" || type === "insurance" ? type : null;
}

/** The payer type of a third party: not stated counts as a person, as on the server. */
export function payerTypeOf(payer: { payer_type?: string | null }): PayerType {
  return organisationPayerType(payer.payer_type) ?? "person";
}

/**
 * Which first answer a stored payer is shown as. "I pay (as a parent)" is not
 * stored as such: it is a person, the patient's parent, with the name of the
 * parent's own data (`template`). Anybody else is "another person or
 * organisation", also the parent after the name was changed.
 */
export function payerAnswer(
  payer: LeadRequestPayer | null | undefined,
  template: PayerSelfTemplate | null | undefined = null,
): PayerAnswer {
  if (!payer) return "";
  if (payer.payer_kind !== "third_party") return "self";
  const parent =
    Boolean(template) &&
    payerTypeOf(payer) === "person" &&
    payer.relationship_kind === "parent" &&
    oneLine(payer.first_name) === oneLine(template?.first_name) &&
    oneLine(payer.last_name) === oneLine(template?.last_name);
  return parent ? "guardian" : "third_party";
}

/**
 * Whether "the patient pays" is offered: a child does not pay, so for a
 * minor only while it is the stored answer of an older request.
 */
export function payerSelfOffered(request: Pick<LeadRequest, "minor" | "payer">): boolean {
  return !request.minor || payerAnswer(request.payer) === "self";
}

/**
 * Whether the third party's e-mail, phone and residence are required to send
 * (owner request 2026-10-07): not of the parent who pays (the own data are
 * known), and a server that lists one as missing gets the mark in any case.
 */
export function payerContactRequired(
  draft: Pick<PayerDraft, "guardian_pays">,
  request: Pick<LeadRequest, "progress">,
  field: "payer_email" | "payer_phone" | "payer_country" | "payer_city",
): boolean {
  return !draft.guardian_pays || request.progress.missing_for_submit.includes(field);
}

/**
 * Whether the consent that GMED sends the payer the cost estimate is asked
 * (contract phase 3b, 11.7). It is the lead's own word about the third party
 * the server has stored, given on its own (not with the answer): asked by a
 * server that knows it (the key is there, also as `null`), not about the
 * parent who pays (`parentPays`, the answer "I pay (as a parent)"). A server
 * that lists it as missing gets the box in any case, or the request could not
 * be sent.
 */
export function costEstimateConsentAsked(request: Pick<LeadRequest, "payer" | "progress">, parentPays: boolean): boolean {
  const payer = request.payer;
  if (payer?.payer_kind !== "third_party") return false;
  if (request.progress.missing_for_submit.includes("payer_cost_estimate_consent")) return true;
  return payer.cost_estimate_consent_at !== undefined && !parentPays;
}

/** The first answer as chosen in the form. */
export function draftAnswer(draft: Pick<PayerDraft, "payer_kind" | "guardian_pays">): PayerAnswer {
  if (draft.payer_kind === "third_party") return draft.guardian_pays ? "guardian" : "third_party";
  return draft.payer_kind === "self" ? "self" : "";
}

/** `template`: the own data of a parent's login, for the answer "I pay (as a parent)". */
export function draftFromPayer(
  payer: LeadRequestPayer | null | undefined,
  template: PayerSelfTemplate | null | undefined = null,
): PayerDraft {
  return {
    payer_kind: payer?.payer_kind ?? "",
    guardian_pays: payerAnswer(payer, template) === "guardian",
    payer_type: payer?.payer_type ?? "",
    organisation_name: payer?.organisation_name ?? "",
    organisation_legal_form: payer?.organisation_legal_form ?? "",
    organisation_register_number: payer?.organisation_register_number ?? "",
    organisation_contact_name: payer?.organisation_contact_name ?? "",
    first_name: payer?.first_name ?? "",
    last_name: payer?.last_name ?? "",
    date_of_birth: payer?.date_of_birth ?? "",
    citizenships: [...(payer?.citizenships ?? [])],
    relationship_kind: payer?.relationship_kind ?? "",
    relationship: payer?.relationship ?? "",
    street: payer?.street ?? "",
    zip: payer?.zip ?? "",
    city: payer?.city ?? "",
    country: payer?.country ?? "",
    phone: payer?.phone ?? "",
    email: payer?.email ?? "",
    messenger: payer?.messenger ?? "",
    contact_consent: Boolean(payer?.contact_consent_at),
    acts_on_own_account: answerFromBoolean(payer?.acts_on_own_account),
    beneficial_owner: payer?.beneficial_owner ?? "",
  };
}

/** Nobody named: what the block holds about a third party, empty. */
function withoutPayerParty(draft: PayerDraft): PayerDraft {
  return {
    ...draft,
    guardian_pays: false,
    payer_type: "",
    organisation_name: "",
    organisation_legal_form: "",
    organisation_register_number: "",
    organisation_contact_name: "",
    first_name: "",
    last_name: "",
    date_of_birth: "",
    citizenships: [],
    relationship_kind: "",
    relationship: "",
    street: "",
    zip: "",
    city: "",
    country: "",
    phone: "",
    email: "",
    messenger: "",
  };
}

/**
 * The draft after the first answer. Another answer names another payer, so
 * the consent to contact the payer is asked again. "I pay (as a parent)"
 * fills the parent's own data in — name, birth date, contact and, where the
 * parent entered them as representative, citizenships and address — which
 * stay editable; "another person or organisation" does not keep them. What
 * was typed about another person stays while "I pay myself" hides it, as before.
 */
export function withPayerAnswer(
  draft: PayerDraft,
  answer: string,
  template: PayerSelfTemplate | null | undefined = null,
): PayerDraft {
  if (answer === draftAnswer(draft)) return draft;
  const next: PayerDraft = { ...draft, contact_consent: false };
  if (answer === "guardian" && template) {
    // Back from another answer the parent's own entries are still there.
    if (draft.guardian_pays) return { ...next, payer_kind: "third_party" };
    return {
      ...withoutPayerParty(next),
      payer_kind: "third_party",
      guardian_pays: true,
      payer_type: "person",
      first_name: template.first_name ?? "",
      last_name: template.last_name ?? "",
      date_of_birth: template.date_of_birth ?? "",
      citizenships: [...(template.citizenships ?? [])],
      relationship_kind: "parent",
      street: template.street ?? "",
      zip: template.zip ?? "",
      city: template.city ?? "",
      country: template.country ?? "",
      phone: template.phone ?? "",
      email: template.email ?? "",
    };
  }
  if (answer === "third_party" || answer === "guardian") {
    return draft.guardian_pays
      ? { ...withoutPayerParty(next), payer_kind: "third_party" }
      : { ...next, payer_kind: "third_party" };
  }
  return { ...next, payer_kind: answer === "self" ? "self" : "" };
}

/**
 * The draft after "who is the payer?". A company, organisation or insurer has
 * the organisation mask (name, legal form, register number, contact person)
 * and no data of a natural person, and the other way round: what does not
 * apply goes, and so does the consent, which was given for the payer named
 * before (the server does the same).
 */
export function withPayerType(draft: PayerDraft, type: string): PayerDraft {
  if (type === payerTypeOf(draft)) return draft;
  const next: PayerDraft = { ...draft, payer_type: type, contact_consent: false };
  if (organisationPayerType(type)) {
    return { ...next, first_name: "", last_name: "", date_of_birth: "", citizenships: [] };
  }
  return {
    ...next,
    organisation_name: "",
    organisation_legal_form: "",
    organisation_register_number: "",
    organisation_contact_name: "",
  };
}

/** The draft after the relationship was chosen: the text belongs to "other" only. */
export function withRelationshipKind(draft: PayerDraft, kind: string): PayerDraft {
  return { ...draft, relationship_kind: kind, relationship: kind === "other" ? draft.relationship : "" };
}

/**
 * What is sent for the payer block: nothing until the question is answered,
 * only the answer for "I pay myself" (the server drops another person's data),
 * and for a third party every filled value: the name of an organisation or
 * the data of a person, never both. The consent to contact the payer always
 * goes with a third party, given or not. The own economic interest goes with
 * either answer once it is stated; "no" always carries the named person (also
 * empty, so a removed text is removed on the server).
 *
 * `typed` is false for a server that does not know the payer type yet (see
 * `knowsPayerType`): it gets the answer of before, a person with the
 * relationship in words. `withConsent` false leaves the consent out (a parent
 * who pays is not asked for it): the server then keeps what it has.
 */
export function payerInput(draft: PayerDraft, typed = true, withConsent = true): LeadRequestPayerInput | null {
  if (draft.payer_kind !== "self" && draft.payer_kind !== "third_party") return null;
  const input: LeadRequestPayerInput = { payer_kind: draft.payer_kind };
  if (draft.payer_kind === "third_party") {
    const type = typed ? payerTypeOf(draft) : "person";
    const put = (
      field:
        | "organisation_name"
        | "organisation_legal_form"
        | "organisation_register_number"
        | "organisation_contact_name"
        | "first_name"
        | "last_name"
        | "date_of_birth"
        | "relationship"
        | "street"
        | "zip"
        | "city"
        | "country"
        | "phone"
        | "email",
    ) => {
      const value = oneLine(draft[field]);
      if (value) input[field] = value;
    };
    if (typed) input.payer_type = type;
    if (type === "person") {
      put("first_name");
      put("last_name");
      put("date_of_birth");
    } else {
      put("organisation_name");
      // The organisation mask exists on a server that knows the payer type only.
      if (typed) {
        put("organisation_legal_form");
        put("organisation_register_number");
        put("organisation_contact_name");
      }
    }
    if (typed && draft.relationship_kind) input.relationship_kind = draft.relationship_kind;
    // In words for "other"; a text stored before the list existed stays until a kind is chosen.
    if (!typed || !draft.relationship_kind || draft.relationship_kind === "other") put("relationship");
    put("street");
    put("zip");
    put("city");
    put("country");
    put("phone");
    put("email");
    // Always with a server that knows the payer type: `""` clears a number.
    if (typed) input.messenger = oneLine(draft.messenger);
    if (type === "person" && draft.citizenships.length > 0) input.citizenships = [...draft.citizenships];
    if (typed && withConsent) input.contact_consent = draft.contact_consent;
  }
  if (draft.acts_on_own_account === "yes") {
    input.acts_on_own_account = true;
  } else if (draft.acts_on_own_account === "no") {
    input.acts_on_own_account = false;
    input.beneficial_owner = draft.beneficial_owner.trim();
  }
  return input;
}

/**
 * The legal yes/no questions (GwG, trigger flow 2026-10-07), in form order.
 * Only the answer is asked here; the details of a "yes" are follow-up blocks
 * H (public office) and J (sanctions), asked when GMED needs them.
 */
export const LEGAL_QUESTIONS = ["pep_self", "pep_related", "sanctions_links"] as const;

export type LegalQuestion = (typeof LEGAL_QUESTIONS)[number];

/** The statements for the identification as the patient types them. */
export type IdentificationDraft = {
  /** "mr", "ms", "none" or "". */
  salutation: string;
  former_names: string;
  birth_place: string;
  birth_country: string;
  habitual_residence_country: string;
  contact_channels: string[];
  /** The legal questions: "yes", "no" or "" (not answered yet). */
  pep_self: string;
  pep_related: string;
  sanctions_links: string;
  /** Block B: why another person pays, and since when they know each other. */
  payment_background: string;
  relationship_since: string;
  /** Block F: residence and citizenships. */
  residence_since: string;
  other_residences: string;
  former_citizenships: string[];
  stay_reason: string;
  stay_reason_details: string;
  /** Block H: the public office. */
  pep_office: string;
  pep_country: string;
  pep_period: string;
  pep_relationship: string;
  pep_wealth_origin: string;
  /** Block J: the link to a sanctioned person or company. */
  sanctions_link_name: string;
  sanctions_link_kind: string;
  sanctions_link_since_extent: string;
  /** "Grund der Anfrage" (13.1). */
  request_reason: string;
};

export type IdentificationField = keyof IdentificationDraft;

/** The statements typed as text, a date, a country or one choice (not a list). */
export type IdentificationTextField = Exclude<IdentificationField, "contact_channels" | "former_citizenships">;

export const IDENTIFICATION_FIELDS: IdentificationField[] = [
  "salutation",
  "former_names",
  "birth_place",
  "birth_country",
  "habitual_residence_country",
  "contact_channels",
  "pep_self",
  "pep_related",
  "sanctions_links",
  "payment_background",
  "relationship_since",
  "residence_since",
  "other_residences",
  "former_citizenships",
  "stay_reason",
  "stay_reason_details",
  "pep_office",
  "pep_country",
  "pep_period",
  "pep_relationship",
  "pep_wealth_origin",
  "sanctions_link_name",
  "sanctions_link_kind",
  "sanctions_link_since_extent",
  "request_reason",
];

export const CONTACT_CHANNELS = ["email", "phone", "messenger"] as const;

export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** Why the patient lives in the country of residence (block F), in form order. */
export const STAY_REASONS = ["work", "study", "family", "other"] as const;

/** What links the patient to a sanctioned person or company (block J), in form order. */
export const SANCTIONS_LINK_KINDS = ["family", "business", "ownership", "other"] as const;

/** Free texts that may run over several lines: only the ends are trimmed. */
const MULTILINE_FIELDS: ReadonlySet<IdentificationField> = new Set([
  "payment_background",
  "other_residences",
  "stay_reason_details",
  "pep_office",
  "pep_relationship",
  "pep_wealth_origin",
  "sanctions_link_since_extent",
  "request_reason",
]);

/** The chosen channels without duplicates, in the order of the form. */
function contactChannels(values: readonly string[]): string[] {
  return CONTACT_CHANNELS.filter((channel) => values.includes(channel));
}

/** Country codes without duplicates, in the order chosen. */
function countryCodes(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)));
}

export function draftFromIdentification(data: LeadRequestIdentification | null | undefined): IdentificationDraft {
  return {
    salutation: data?.salutation ?? "",
    former_names: data?.former_names ?? "",
    birth_place: data?.birth_place ?? "",
    birth_country: data?.birth_country ?? "",
    habitual_residence_country: data?.habitual_residence_country ?? "",
    contact_channels: contactChannels(data?.contact_channels ?? []),
    pep_self: answerFromBoolean(data?.pep_self),
    pep_related: answerFromBoolean(data?.pep_related),
    sanctions_links: answerFromBoolean(data?.sanctions_links),
    payment_background: data?.payment_background ?? "",
    relationship_since: data?.relationship_since ?? "",
    residence_since: data?.residence_since ?? "",
    other_residences: data?.other_residences ?? "",
    former_citizenships: countryCodes(data?.former_citizenships ?? []),
    stay_reason: data?.stay_reason ?? "",
    stay_reason_details: data?.stay_reason_details ?? "",
    pep_office: data?.pep_office ?? "",
    pep_country: data?.pep_country ?? "",
    pep_period: data?.pep_period ?? "",
    pep_relationship: data?.pep_relationship ?? "",
    pep_wealth_origin: data?.pep_wealth_origin ?? "",
    sanctions_link_name: data?.sanctions_link_name ?? "",
    sanctions_link_kind: data?.sanctions_link_kind ?? "",
    sanctions_link_since_extent: data?.sanctions_link_since_extent ?? "",
    request_reason: data?.request_reason ?? "",
  };
}

/** The draft after the answer to a legal question: only the answer (the details are follow-up blocks). */
export function withLegalAnswer(draft: IdentificationDraft, question: LegalQuestion, answer: string): IdentificationDraft {
  return { ...draft, [question]: answer };
}

/** A contact channel switched on or off. */
export function withContactChannel(draft: IdentificationDraft, channel: ContactChannel, chosen: boolean): IdentificationDraft {
  const rest = draft.contact_channels.filter((item) => item !== channel);
  return { ...draft, contact_channels: contactChannels(chosen ? [...rest, channel] : rest) };
}

/** The comparable form of a field: what would be sent, as text. */
export function identificationValue(field: IdentificationField, draft: IdentificationDraft): string {
  if (field === "contact_channels") return contactChannels(draft.contact_channels).join(",");
  if (field === "former_citizenships") return countryCodes(draft.former_citizenships).join(",");
  const value = draft[field].trim();
  return MULTILINE_FIELDS.has(field) ? value : value.replace(/\s+/g, " ");
}

/** Values the server refused, by field; none of them is sent again until the patient changes it. */
export type RejectedIdentification = Partial<Record<IdentificationField, string>>;

/**
 * Only the statements that differ from the last saved state. A cleared text
 * is sent as `""`, a legal answer as `true`, `false` or `null`, and a refused
 * value is not repeated.
 */
export function identificationPatch(
  saved: IdentificationDraft,
  draft: IdentificationDraft,
  rejected: RejectedIdentification = {},
): IdentificationPatch {
  const patch: IdentificationPatch = {};
  for (const field of IDENTIFICATION_FIELDS) {
    const next = identificationValue(field, draft);
    if (next === identificationValue(field, saved)) continue;
    if (rejected[field] === next) continue;
    if (field === "contact_channels") patch[field] = contactChannels(draft.contact_channels);
    else if (field === "former_citizenships") patch[field] = countryCodes(draft.former_citizenships);
    else if ((LEGAL_QUESTIONS as readonly string[]).includes(field)) patch[field] = booleanFromAnswer(next);
    else patch[field] = next;
  }
  return patch;
}

/** Notes that the server refused the current value of `field`; other fields keep their entry. */
export function withRejectedIdentification(
  rejected: RejectedIdentification,
  field: string,
  draft: IdentificationDraft,
): RejectedIdentification | null {
  if (!IDENTIFICATION_FIELDS.includes(field as IdentificationField)) return null;
  const key = field as IdentificationField;
  return { ...rejected, [key]: identificationValue(key, draft) };
}

/** The refusals that still apply: a value the patient changed since may be sent again. */
export function stillRejectedIdentification(
  rejected: RejectedIdentification,
  draft: IdentificationDraft,
): RejectedIdentification {
  const next: RejectedIdentification = {};
  for (const field of IDENTIFICATION_FIELDS) {
    if (rejected[field] !== undefined && rejected[field] === identificationValue(field, draft)) next[field] = rejected[field];
  }
  return next;
}

/**
 * Keys of the identification in `progress.missing_for_submit`: its fields
 * and the upload of the identity document.
 */
export type IdentificationSubmitField = IdentificationField | "id_document_upload";

/**
 * A field of the personal data, of the payer block, of the identification, of
 * the representation or of the billing.
 */
export type SubmitField =
  | PersonalField
  | PayerField
  | IdentificationSubmitField
  | RepresentationSubmitField
  | BillingSubmitField;

/**
 * Everything `progress.missing_for_submit` can name, in the order of the
 * steps (trigger flow 2026-10-07): person and representation, contact and
 * residence, identity document (upload only), who pays, insurance and
 * invoice, declarations, the reason of the request. The payment route
 * (section 8) is a follow-up block now; its keys stay for an older server.
 */
export const SUBMIT_FIELDS: SubmitField[] = [
  // Person
  "salutation",
  "first_name",
  "last_name",
  "middle_name",
  "former_names",
  "date_of_birth",
  "birth_place",
  "birth_country",
  "legal_sex",
  "citizenships",
  // Who acts for the lead: the answers and the persons
  ...REPRESENTATION_SUBMIT_FIELDS,
  // Address and residence
  "street_address",
  "zip_code",
  "city",
  "country",
  "habitual_residence_country",
  // Contact
  "phone",
  "primary_language",
  "contact_channels",
  // Identity document: the copy only, the data are entered by GMED
  "id_document_upload",
  // Who pays
  "payer_kind",
  "payer_type",
  "payer_organisation_name",
  "payer_legal_form",
  "payer_register_number",
  "payer_contact_name",
  "payer_first_name",
  "payer_last_name",
  "payer_citizenships",
  "payer_date_of_birth",
  "payer_relationship_kind",
  "payer_relationship",
  "payer_email_or_phone",
  "payer_email",
  "payer_phone",
  "payer_messenger",
  // The payer's residence or seat: country and city, then street and ZIP
  "payer_country",
  "payer_city",
  "payer_street",
  "payer_zip",
  "payer_contact_consent",
  "payer_cost_estimate_consent",
  "payer_own_account",
  "payer_beneficial_owner",
  // Insurance
  "has_insurance",
  "insurance_type",
  "insurance_provider",
  "insurance_number",
  "insurance_covers_germany",
  // Invoice recipient (and, from an older server, the payment route)
  ...BILLING_SUBMIT_FIELDS,
  // Declarations
  "pep_self",
  "pep_related",
  "sanctions_links",
  // The reason of the request (13.1)
  "request_reason",
];

/** Fields still missing for "send to the manager", in form order. */
export function missingForSubmit(request: Pick<LeadRequest, "progress">): SubmitField[] {
  const missing = new Set(request.progress.missing_for_submit);
  return SUBMIT_FIELDS.filter((field) => missing.has(field));
}

/** The autosave state of one part of the form. */
export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * The one save indicator of the step: the parts of the form save on their
 * own, and a part that could not be saved is not hidden by another that was.
 */
export function combinedSaveState(states: readonly SaveState[]): SaveState {
  if (states.includes("saving")) return "saving";
  if (states.includes("error")) return "error";
  return states.includes("saved") ? "saved" : "idle";
}

export function consentGiven(request: Pick<LeadRequest, "consents">, purpose: string): boolean {
  return Boolean(request.consents[purpose]?.given_at);
}

/**
 * Something changed after the request was sent: only then "send again" is
 * offered. An older server does not say so; documents uploaded later still count.
 */
export function changedSinceSubmit(
  request: Pick<LeadRequest, "submitted_at" | "changed_since_submit" | "documents">,
): boolean {
  if (!request.submitted_at) return false;
  if (typeof request.changed_since_submit === "boolean") return request.changed_since_submit;
  const sentAt = Date.parse(request.submitted_at);
  return request.documents.some((document) => Date.parse(document.uploaded_at) > sentAt);
}

export function canSubmit(request: Pick<LeadRequest, "progress" | "consents">, inquiryPurpose: string): boolean {
  return request.progress.missing_for_submit.length === 0 && consentGiven(request, inquiryPurpose);
}

/** The consent text in the cabinet language, German as fallback. */
export function consentText(request: Pick<LeadRequest, "consents">, purpose: string, lang: string): string {
  const texts = request.consents[purpose]?.texts ?? {};
  return texts[lang] ?? texts.de ?? "";
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function formatFileSize(size: number | null | undefined, lang: string): string {
  if (!size || size <= 0) return "";
  const locale = cabinetLocale(lang);
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024)).toLocaleString(locale)} KB`;
}

/** Number and name locale of a cabinet language (DE, EN, UA, RU). */
export function cabinetLocale(lang: string): string {
  switch (lang) {
    case "de":
      return "de-DE";
    case "en":
      return "en-GB";
    case "uk":
      return "uk-UA";
    default:
      return "ru-RU";
  }
}

/** A language code as a name in the cabinet language, e.g. "uk" → "українська". */
export function languageName(code: string, lang: string): string {
  const display = cachedLanguageDisplayNames(cabinetLocale(lang).slice(0, 2));
  try {
    const name = display?.of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(cabinetLocale(lang)) + name.slice(1);
  } catch {
    return code;
  }
}
