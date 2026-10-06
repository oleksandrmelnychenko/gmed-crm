import {
  PAYMENT_ROUTE_FIELDS,
  billingValue,
  type BillingDraft,
  type BillingField,
} from "@/pages/patient-lead/lead-request-billing-model";

import type { PayerAnswers, PayerAnswersPatch, PayerBeneficialOwner, PayerQuestionnaire, PayerType } from "./payer-link-api";

// The payer's own link (contract phase 3a, 5.1): the questionnaire as typed,
// what is sent, and what is missing. Pure functions without the browser, so
// they run in the unit tests. The link token, the session and the error
// codes are in `payer-link-session.ts`.

// ---------------------------------------------------------------------------
// Fields and the draft
// ---------------------------------------------------------------------------

export const ORGANISATION_TYPES = ["company", "organisation", "insurance"] as const;
export type OrganisationType = (typeof ORGANISATION_TYPES)[number];

export function isOrganisation(payerType: PayerType): payerType is OrganisationType {
  return payerType !== "person";
}

export const SALUTATIONS = ["mr", "ms", "none"] as const;
export type Salutation = (typeof SALUTATIONS)[number];

export const CONTACT_CHANNELS = ["email", "phone", "messenger"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const ID_DOCUMENT_TYPES = ["passport", "id_card", "residence_permit"] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

/** How the payer is related to the patient (the declaration's list). */
export const RELATIONSHIP_KINDS = [
  "spouse",
  "parent",
  "child",
  "relative",
  "employer",
  "friend",
  "business_partner",
  "other",
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

/** Where a person's money comes from (the declaration's SOURCE_OF_FUNDS). */
export const FUNDS_SOURCES = ["employment", "business_income", "savings", "asset_sale", "inheritance_gift", "other"] as const;
/** Where the money of a company, an organisation or an insurer comes from (QA 2026-10-06). */
export const ORGANISATION_FUNDS_SOURCES = ["business_revenue", "equity", "loan", "insurance_benefit", "donation", "other"] as const;
export type FundsSource = (typeof FUNDS_SOURCES)[number] | (typeof ORGANISATION_FUNDS_SOURCES)[number];

/** Every source the page can name, persons' first (the order of a read-only list). */
export const ALL_FUNDS_SOURCES: readonly FundsSource[] = [
  ...FUNDS_SOURCES,
  ...ORGANISATION_FUNDS_SOURCES.filter((source) => source !== "other"),
];

/**
 * The sources the questionnaire offers, in form order: the server's list for
 * the payer type (`funds_source_options`), else — on an older server — the
 * persons' list as before. Values the page cannot name are left out.
 */
export function fundsSourceOptions(questionnaire: { funds_source_options?: unknown } | null | undefined): FundsSource[] {
  const options = questionnaire?.funds_source_options;
  if (!Array.isArray(options)) return [...FUNDS_SOURCES];
  const known = options.filter(
    (option, index): option is FundsSource =>
      typeof option === "string" && ALL_FUNDS_SOURCES.includes(option as FundsSource) && options.indexOf(option) === index,
  );
  return known.length > 0 ? known : [...FUNDS_SOURCES];
}

export const LEGAL_QUESTIONS = ["pep_self", "pep_related", "high_risk_country", "sanctions_links"] as const;
export type LegalQuestion = (typeof LEGAL_QUESTIONS)[number];

/** The details a "yes" asks for. */
export const LEGAL_DETAILS = {
  pep_self: "pep_self_details",
  pep_related: "pep_related_details",
  high_risk_country: "high_risk_country_code",
  sanctions_links: "sanctions_links_details",
} as const satisfies Record<LegalQuestion, string>;

/** Answers typed as one line of text, a date, a country or one choice of a list. */
export const PAYER_TEXT_FIELDS = [
  "salutation",
  "first_name",
  "last_name",
  "former_names",
  "date_of_birth",
  "birth_place",
  "birth_country",
  "street",
  "zip",
  "city",
  "country",
  "habitual_residence_country",
  "phone",
  "language",
  "id_document_type",
  "id_document_number",
  "id_issuing_authority",
  "id_issuing_country",
  "id_issued_on",
  "id_valid_until",
  "organisation_name",
  "register_court",
  "register_number",
  "representative_first_name",
  "representative_last_name",
  "representative_role",
  "relationship_kind",
  "relationship",
  "occupation",
  "industry",
  "funds_description",
  "pep_self_details",
  "pep_related_details",
  "high_risk_country_code",
  "sanctions_links_details",
] as const;
export type PayerTextField = (typeof PAYER_TEXT_FIELDS)[number];

/** Yes/no answers, typed as "yes", "no" or "" (not answered). */
export const PAYER_CHOICE_FIELDS = [...LEGAL_QUESTIONS, "beneficial_owners_none"] as const;
export type PayerChoiceField = (typeof PAYER_CHOICE_FIELDS)[number];

export type PayerListField = "citizenships" | "funds_sources";

/** Section 8 of phase 2, asked here when the payer answers it. */
export type PaymentRouteField = Exclude<BillingField, "invoice_to" | "invoice_name" | "invoice_street" | "invoice_zip" | "invoice_city" | "invoice_country" | "invoice_email">;
export const PAYMENT_ROUTE_KEYS = PAYMENT_ROUTE_FIELDS as readonly PaymentRouteField[];

export type PayerField = PayerTextField | PayerChoiceField | PayerListField | "beneficial_owners" | PaymentRouteField;

/** Every key the page may send, in the order of the form. */
export const PAYER_FIELDS: readonly PayerField[] = [
  "salutation",
  "first_name",
  "last_name",
  "former_names",
  "date_of_birth",
  "birth_place",
  "birth_country",
  "citizenships",
  "street",
  "zip",
  "city",
  "country",
  "habitual_residence_country",
  "phone",
  "language",
  "id_document_type",
  "id_document_number",
  "id_issuing_authority",
  "id_issuing_country",
  "id_issued_on",
  "id_valid_until",
  "organisation_name",
  "register_court",
  "register_number",
  "representative_first_name",
  "representative_last_name",
  "representative_role",
  "beneficial_owners",
  "beneficial_owners_none",
  "relationship_kind",
  "relationship",
  "occupation",
  "industry",
  "funds_sources",
  "funds_description",
  "pep_self",
  "pep_self_details",
  "pep_related",
  "pep_related_details",
  "high_risk_country",
  "high_risk_country_code",
  "sanctions_links",
  "sanctions_links_details",
  ...PAYMENT_ROUTE_KEYS,
];

/** Keys only a private person has; sending one for an organisation is refused (422). */
const PERSON_ONLY: ReadonlySet<PayerField> = new Set([
  "salutation",
  "first_name",
  "last_name",
  "former_names",
  "date_of_birth",
  "birth_place",
  "birth_country",
  "citizenships",
  "habitual_residence_country",
  "occupation",
]);

/** Keys only a company, an organisation or an insurer has. */
const ORGANISATION_ONLY: ReadonlySet<PayerField> = new Set([
  "organisation_name",
  "register_court",
  "register_number",
  "representative_first_name",
  "representative_last_name",
  "representative_role",
  "beneficial_owners",
  "beneficial_owners_none",
  "industry",
]);

/** Whether the field belongs to this payer type. */
export function fieldOfPayerType(field: PayerField, payerType: PayerType): boolean {
  return isOrganisation(payerType) ? !PERSON_ONLY.has(field) : !ORGANISATION_ONLY.has(field);
}

export function isPaymentRouteField(field: string): field is PaymentRouteField {
  return (PAYMENT_ROUTE_KEYS as readonly string[]).includes(field);
}

export function isPayerField(field: string): field is PayerField {
  return (PAYER_FIELDS as readonly string[]).includes(field);
}

/** Free texts that may run over several lines: only the ends are trimmed. */
const MULTILINE_FIELDS: ReadonlySet<PayerField> = new Set([
  "funds_description",
  "pep_self_details",
  "pep_related_details",
  "sanctions_links_details",
  "via_third_party_details",
]);

export const OWNER_FIELDS = [
  "first_name",
  "last_name",
  "date_of_birth",
  "birth_place",
  "street",
  "zip",
  "city",
  "country",
  "share_percent",
] as const;
export type OwnerField = (typeof OWNER_FIELDS)[number];
export type OwnerDraft = Record<OwnerField, string>;

export const MAX_OWNERS = 10;

export type PayerDraft = Record<PayerTextField | PayerChoiceField | PaymentRouteField, string> & {
  citizenships: string[];
  funds_sources: string[];
  beneficial_owners: OwnerDraft[];
};

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function choice(value: boolean | null | undefined): string {
  return value === true ? "yes" : value === false ? "no" : "";
}

function shareText(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? String(number) : String(value);
}

export function emptyOwner(): OwnerDraft {
  return {
    first_name: "",
    last_name: "",
    date_of_birth: "",
    birth_place: "",
    street: "",
    zip: "",
    city: "",
    country: "",
    share_percent: "",
  };
}

function ownerDraft(owner: PayerBeneficialOwner): OwnerDraft {
  return {
    first_name: text(owner.first_name),
    last_name: text(owner.last_name),
    date_of_birth: text(owner.date_of_birth),
    birth_place: text(owner.birth_place),
    street: text(owner.street),
    zip: text(owner.zip),
    city: text(owner.city),
    country: text(owner.country),
    share_percent: shareText(owner.share_percent),
  };
}

/** The questionnaire as the form shows it: texts, "yes"/"no"/"" and lists. */
export function draftFromQuestionnaire(questionnaire: Pick<PayerQuestionnaire, "answers" | "payment_route">): PayerDraft {
  const answers: Partial<PayerAnswers> = questionnaire.answers ?? {};
  const route = questionnaire.payment_route;
  const draft = {} as PayerDraft;
  for (const field of PAYER_TEXT_FIELDS) draft[field] = text(answers[field]);
  for (const field of LEGAL_QUESTIONS) draft[field] = choice(answers[field]);
  draft.beneficial_owners_none = answers.beneficial_owners_none ? "yes" : "";
  draft.citizenships = [...(answers.citizenships ?? [])];
  draft.funds_sources = [...(answers.funds_sources ?? [])];
  draft.beneficial_owners = (answers.beneficial_owners ?? []).map(ownerDraft);
  draft.payment_method = text(route?.payment_method);
  draft.payment_method_details = text(route?.payment_method_details);
  draft.account_country = text(route?.account_country);
  draft.account_holder = text(route?.account_holder);
  draft.bank_name = text(route?.bank_name);
  draft.via_third_party = choice(route?.via_third_party);
  draft.via_third_party_details = text(route?.via_third_party_details);
  return draft;
}

/** The payment route of the draft as phase 2's model reads it (section 7 empty). */
export function routeDraft(draft: PayerDraft): BillingDraft {
  return {
    invoice_to: "",
    invoice_name: "",
    invoice_street: "",
    invoice_zip: "",
    invoice_city: "",
    invoice_country: "",
    invoice_email: "",
    payment_method: draft.payment_method,
    payment_method_details: draft.payment_method_details,
    account_country: draft.account_country,
    account_holder: draft.account_holder,
    bank_name: draft.bank_name,
    via_third_party: draft.via_third_party,
    via_third_party_details: draft.via_third_party_details,
  };
}

/** The draft after a change of phase 2's model (`withPaymentMethod`, `withViaThirdParty`). */
export function withRoute(draft: PayerDraft, route: BillingDraft): PayerDraft {
  const next = { ...draft };
  for (const field of PAYMENT_ROUTE_KEYS) next[field] = route[field];
  return next;
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizedShare(value: string): string {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return "";
  const number = Number(trimmed);
  return Number.isFinite(number) ? String(number) : trimmed;
}

function ownerValue(owner: OwnerDraft): string {
  return OWNER_FIELDS.map((field) => (field === "share_percent" ? normalizedShare(owner[field]) : collapse(owner[field]))).join("\u001f");
}

/** The comparable form of a field: what would be sent, as text. */
export function fieldValue(field: PayerField, draft: PayerDraft): string {
  if (field === "citizenships" || field === "funds_sources") return draft[field].join(",");
  if (field === "beneficial_owners") return draft.beneficial_owners.map(ownerValue).join("\u001e");
  if (isPaymentRouteField(field)) return billingValue(field, routeDraft(draft));
  const value = draft[field].trim();
  return MULTILINE_FIELDS.has(field) ? value : value.replace(/\s+/g, " ");
}

/** A share in percent as the server takes it: 0 < x ≤ 100, two decimals; null when not a number. */
export function parseShare(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return number > 0 && number <= 100 ? number : null;
}

export type OwnerProblem = "incomplete" | "share";

/**
 * What keeps the list of beneficial owners from being sent: a person without
 * both names, a share that is not 0 < x ≤ 100, and the shares together over
 * 100 % (`total`). A list in this state stays on the page until it is fixed.
 */
export function ownerProblems(owners: readonly OwnerDraft[]): { rows: (OwnerProblem | null)[]; total: boolean } {
  const rows = owners.map((owner): OwnerProblem | null => {
    if (!collapse(owner.first_name) || !collapse(owner.last_name)) return "incomplete";
    return parseShare(owner.share_percent) === null ? "share" : null;
  });
  const sum = owners.reduce((total, owner) => total + (parseShare(owner.share_percent) ?? 0), 0);
  return { rows, total: Math.round(sum * 100) > 100 * 100 };
}

export function ownersReady(owners: readonly OwnerDraft[]): boolean {
  const problems = ownerProblems(owners);
  return !problems.total && problems.rows.every((problem) => problem === null);
}

/** The list as the server takes it (contract 3.4): names and share required, empty texts as null. */
export function ownersPayload(owners: readonly OwnerDraft[]): PayerBeneficialOwner[] {
  return owners.map((owner) => {
    const value = (field: Exclude<OwnerField, "share_percent">) => collapse(owner[field]) || null;
    return {
      first_name: value("first_name"),
      last_name: value("last_name"),
      date_of_birth: value("date_of_birth"),
      birth_place: value("birth_place"),
      street: value("street"),
      zip: value("zip"),
      city: value("city"),
      country: value("country"),
      share_percent: parseShare(owner.share_percent),
    };
  });
}

/** Values the server refused, by field; none of them is sent again until it is changed. */
export type RejectedFields = Partial<Record<PayerField, string>>;

export type PatchContext = {
  payerType: PayerType;
  /** Section 8 is the payer's to answer (`payment_route.asked`). */
  routeAsked: boolean;
};

/** Whether the field is sent at all for this payer and this questionnaire. */
export function sendsField(field: PayerField, context: PatchContext): boolean {
  if (isPaymentRouteField(field)) return context.routeAsked;
  return fieldOfPayerType(field, context.payerType);
}

/**
 * Only the fields that differ from the last saved state (contract 3.4). A
 * cleared text is sent as `""`, a yes/no answer as `true`, `false` or `null`,
 * the lists whole. A refused value is not repeated; keys of the other payer
 * type and section 8 that is not asked are never sent (the server refuses
 * them). The beneficial owners go only as a complete list.
 */
export function answersPatch(
  saved: PayerDraft,
  draft: PayerDraft,
  context: PatchContext,
  rejected: RejectedFields = {},
): PayerAnswersPatch {
  const patch: PayerAnswersPatch = {};
  for (const field of PAYER_FIELDS) {
    if (!sendsField(field, context)) continue;
    const next = fieldValue(field, draft);
    if (next === fieldValue(field, saved)) continue;
    if (rejected[field] === next) continue;
    if (field === "beneficial_owners") {
      if (!ownersReady(draft.beneficial_owners)) continue;
      patch[field] = ownersPayload(draft.beneficial_owners);
    } else if (field === "citizenships" || field === "funds_sources") {
      patch[field] = [...draft[field]];
    } else if (field === "beneficial_owners_none") {
      patch[field] = next === "yes";
    } else if ((LEGAL_QUESTIONS as readonly string[]).includes(field) || field === "via_third_party") {
      patch[field] = next === "yes" ? true : next === "no" ? false : null;
    } else {
      patch[field] = next;
    }
  }
  return patch;
}

/** Notes that the server refused the current value of `field`; null for a key the page does not know. */
export function withRejectedField(rejected: RejectedFields, field: string, draft: PayerDraft): RejectedFields | null {
  if (!isPayerField(field)) return null;
  return { ...rejected, [field]: fieldValue(field, draft) };
}

/** The refusals that still apply: a value changed since may be sent again. */
export function stillRejected(rejected: RejectedFields, draft: PayerDraft): RejectedFields {
  const next: RejectedFields = {};
  for (const field of PAYER_FIELDS) {
    const value = rejected[field];
    if (value !== undefined && value === fieldValue(field, draft)) next[field] = value;
  }
  return next;
}

/**
 * The field the server names in a refusal. An expired document may come
 * without a field: it is the "valid until" date then.
 */
export function refusedField(code: string, body: Record<string, unknown>): string {
  if (typeof body.field === "string" && body.field) return body.field;
  return code === "id_document_expired" ? "id_valid_until" : "";
}

/**
 * After a save: the fields the server stored otherwise than sent (trimmed
 * texts) or changed on its own (a habitual residence equal to the country,
 * cleared details) and that were not typed again since the save started —
 * the draft takes the saved value over. A refused value stays, and so does a
 * field that was held back (an unfinished list of beneficial owners).
 */
export function reconcileDraft(
  current: PayerDraft,
  snapshot: PayerDraft,
  previousSaved: PayerDraft,
  saved: PayerDraft,
  sentFields: readonly string[],
  rejected: RejectedFields = {},
): PayerDraft {
  let next: PayerDraft | null = null;
  for (const field of PAYER_FIELDS) {
    if (rejected[field] !== undefined) continue;
    const typed = fieldValue(field, snapshot);
    if (fieldValue(field, current) !== typed) continue;
    const stored = fieldValue(field, saved);
    const changed = sentFields.includes(field) ? stored !== typed : stored !== fieldValue(field, previousSaved);
    if (!changed || stored === typed) continue;
    next ??= { ...current };
    (next as Record<string, unknown>)[field] = saved[field];
  }
  return next ?? current;
}

/** The fields another write changed on the server since the last save. */
export function changedOnServer(saved: PayerDraft, incoming: PayerDraft): PayerField[] {
  return PAYER_FIELDS.filter((field) => fieldValue(field, saved) !== fieldValue(field, incoming));
}

/** The draft after a yes/no answer: the details belong to a "yes". */
export function withLegalAnswer(draft: PayerDraft, question: LegalQuestion, answer: string): PayerDraft {
  const next: PayerDraft = { ...draft, [question]: answer };
  if (answer !== "yes") next[LEGAL_DETAILS[question]] = "";
  return next;
}

/** The draft after the relationship: the free text belongs to "other". */
export function withRelationshipKind(draft: PayerDraft, kind: string): PayerDraft {
  return { ...draft, relationship_kind: kind, relationship: kind === "other" ? draft.relationship : "" };
}

/**
 * A source of funds checked or unchecked, in the order of the offered list
 * (the persons' list unless the questionnaire offers another one); a value
 * the list does not offer is dropped, the server would refuse it.
 */
export function withFundsSource(
  draft: PayerDraft,
  source: FundsSource,
  chosen: boolean,
  options: readonly FundsSource[] = FUNDS_SOURCES,
): PayerDraft {
  const rest = draft.funds_sources.filter((item) => item !== source);
  const next = chosen ? [...rest, source] : rest;
  return { ...draft, funds_sources: options.filter((item) => next.includes(item)) };
}

/** "Nobody holds more than 25 %": the list goes; unchecked, the list may be filled again. */
export function withOwnersNone(draft: PayerDraft, none: boolean): PayerDraft {
  return { ...draft, beneficial_owners_none: none ? "yes" : "", beneficial_owners: none ? [] : draft.beneficial_owners };
}

/** A contact channel switched on or off, in the order of the list. */
export function withContactChannel(channels: readonly string[], channel: ContactChannel, chosen: boolean): string[] {
  const rest = channels.filter((item) => item !== channel);
  const next = chosen ? [...rest, channel] : rest;
  return CONTACT_CHANNELS.filter((item) => next.includes(item));
}

// ---------------------------------------------------------------------------
// Steps and what is missing
// ---------------------------------------------------------------------------

export const PAYER_STEPS = ["privacy", "details", "identity", "owners", "funds", "payment", "declarations", "summary"] as const;
export type PayerStep = (typeof PAYER_STEPS)[number];

/** The steps of this questionnaire: beneficial owners only for organisations, section 8 only when asked. */
export function payerSteps(payerType: PayerType, routeAsked: boolean): PayerStep[] {
  return PAYER_STEPS.filter((step) => {
    if (step === "owners") return isOrganisation(payerType);
    if (step === "payment") return routeAsked;
    return true;
  });
}

const PAYMENT_ROUTE_MISSING = [
  "payment_method",
  "payment_method_details",
  "account_country",
  "account_holder",
  "bank_name",
  "via_third_party",
  "via_third_party_details",
] as const;

const DECLARATIONS_MISSING = [
  "pep_self",
  "pep_self_details",
  "pep_related",
  "pep_related_details",
  "high_risk_country",
  "high_risk_country_code",
  "sanctions_links",
  "sanctions_links_details",
] as const;

const ID_MISSING = [
  "id_document_type",
  "id_document_number",
  "id_issuing_authority",
  "id_issuing_country",
  "id_issued_on",
  "id_valid_until",
  "id_document_upload",
] as const;

const FUNDS_MISSING = ["funds_sources", "funds_description", "funds_proof_upload"] as const;

/** The order of `missing_for_submit` for a private person (contract 3.5). */
export const PERSON_MISSING_ORDER: readonly string[] = [
  "privacy_ack",
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
  ...ID_MISSING,
  "relationship_kind",
  "relationship",
  "occupation",
  ...FUNDS_MISSING,
  ...PAYMENT_ROUTE_MISSING,
  ...DECLARATIONS_MISSING,
];

/** The order for a company, an organisation or an insurer (contract 3.5). */
export const ORGANISATION_MISSING_ORDER: readonly string[] = [
  "privacy_ack",
  "organisation_name",
  "street",
  "zip",
  "city",
  "country",
  "register_court",
  "register_number",
  "representative_first_name",
  "representative_last_name",
  ...ID_MISSING,
  "beneficial_owners",
  "relationship_kind",
  "relationship",
  "industry",
  ...FUNDS_MISSING,
  ...PAYMENT_ROUTE_MISSING,
  ...DECLARATIONS_MISSING,
];

/** The step that asks a key of `missing_for_submit`. */
export function stepOfMissing(key: string): PayerStep {
  if (key === "privacy_ack") return "privacy";
  if ((ID_MISSING as readonly string[]).includes(key)) return "identity";
  if (key === "beneficial_owners" || key === "beneficial_owners_none") return "owners";
  if (["relationship_kind", "relationship", "occupation", "industry", ...FUNDS_MISSING].includes(key)) return "funds";
  if ((PAYMENT_ROUTE_MISSING as readonly string[]).includes(key)) return "payment";
  if ((DECLARATIONS_MISSING as readonly string[]).includes(key)) return "declarations";
  if (isPayerField(key) || key === "email") return "details";
  return "summary";
}

/** The missing keys in the order of the form; unknown keys last, each key once. */
export function sortMissing(missing: readonly string[], payerType: PayerType): string[] {
  const order = isOrganisation(payerType) ? ORGANISATION_MISSING_ORDER : PERSON_MISSING_ORDER;
  const unique = Array.from(new Set(missing));
  const rank = (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };
  return unique
    .map((key, index) => ({ key, index }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.index - b.index)
    .map((item) => item.key);
}

/** The required fields of the form: the keys the server can name as missing for this payer type. */
export function requiredFields(payerType: PayerType): ReadonlySet<string> {
  const required = new Set(isOrganisation(payerType) ? ORGANISATION_MISSING_ORDER : PERSON_MISSING_ORDER);
  // Asked, but never missing on its own (contract 3.5 names five ID keys for a person).
  required.delete("id_issued_on");
  if (payerType !== "company") {
    required.delete("register_court");
    required.delete("register_number");
    required.delete("beneficial_owners");
  }
  return required;
}

/** The missing keys grouped by the step that asks them, in the order of the steps. */
export function missingByStep(
  missing: readonly string[],
  payerType: PayerType,
  steps: readonly PayerStep[],
): { step: PayerStep; keys: string[] }[] {
  const groups = new Map<PayerStep, string[]>();
  for (const key of sortMissing(missing, payerType)) {
    // A key of a step this questionnaire does not have (or an unknown key) is listed under the summary.
    const own = stepOfMissing(key);
    const step = steps.includes(own) ? own : "summary";
    groups.set(step, [...(groups.get(step) ?? []), key]);
  }
  return [...steps, ...(steps.includes("summary") ? [] : (["summary"] as PayerStep[]))]
    .filter((step) => groups.has(step))
    .map((step) => ({ step, keys: groups.get(step) ?? [] }));
}
