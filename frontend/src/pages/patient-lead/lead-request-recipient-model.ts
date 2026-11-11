import type {
  InvoiceRecipient,
  LeadRequest,
  LeadRequestBilling,
  LeadRequestPayer,
  LeadRequestPayerInput,
  LeadRequestRepresentative,
  PayerSelfTemplate,
  RecipientPatch,
  RecipientType,
} from "./lead-request-api";

// Step 3 "Versicherung & Rechnung" (owner spec 2026-10-11): the invoice
// recipient comes first and absorbs "who pays". This module imports types
// only, so that `lead-request-model` can take the keys of
// `progress.missing_for_submit` from here.
//
//   "Кто является получателем счёта?"            я / третье лицо или организация
//   a third party: физлицо / организация, with its data
//   [x] "Получатель счёта является плательщиком"  a box, ticked by default
//   unticked, a third-party recipient:  "Плательщиком счёта является пациент"
//     (a parent's login: "…являюсь я (как родитель)") / "…другое лицо или
//     организация" with the payer's data
//   unticked, the patient side as recipient: only "другое лицо или
//     организация", shown at once
//
// The answers are stored apart (billing route, `invoice_recipient*` and
// `recipient_*`); the payer stays the payer declaration (`POST …/payer`).

export const RECIPIENT_ANSWERS = ["self", "third_party"] as const satisfies readonly InvoiceRecipient[];

export const RECIPIENT_TYPES = ["person", "organisation"] as const satisfies readonly RecipientType[];

/** The recipient as the lead types it (strings; the yes/no answer as "yes", "no" or ""). */
export type RecipientDraft = {
  /** "self", "third_party" or "". */
  recipient: string;
  representative_id: string;
  /** "Is the recipient the payer?": "yes", "no" or "". */
  is_payer: string;
  /** "person", "organisation" or "". */
  type: string;
  first_name: string;
  last_name: string;
  organisation_name: string;
  legal_form: string;
  contact_name: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  relationship_kind: string;
  relationship: string;
  payment_reason: string;
};

export type RecipientField = Exclude<keyof RecipientDraft, "recipient" | "is_payer">;

/** The data fields of a third-party recipient in form order, with the key the server takes. */
export const RECIPIENT_FIELDS: readonly RecipientField[] = [
  "representative_id",
  "type",
  "first_name",
  "last_name",
  "organisation_name",
  "legal_form",
  "contact_name",
  "relationship_kind",
  "relationship",
  "street",
  "zip",
  "city",
  "country",
  "email",
  "phone",
  "payment_reason",
];

/** Free texts that may run over several lines: only the ends are trimmed. */
const MULTILINE: ReadonlySet<RecipientField> = new Set(["payment_reason"]);

export function draftFromRecipient(billing: LeadRequestBilling | null | undefined): RecipientDraft {
  const party = billing?.recipient ?? null;
  const answer = billing?.invoice_recipient_is_payer;
  return {
    recipient: billing?.invoice_recipient ?? "",
    representative_id: party?.representative_id ?? "",
    is_payer: answer == null ? "" : answer ? "yes" : "no",
    type: party?.type ?? "",
    first_name: party?.first_name ?? "",
    last_name: party?.last_name ?? "",
    // An older request's "another address" is named in one line.
    organisation_name: party?.organisation_name ?? "",
    legal_form: party?.legal_form ?? "",
    contact_name: party?.contact_name ?? "",
    street: party?.street ?? "",
    zip: party?.zip ?? "",
    city: party?.city ?? "",
    country: party?.country ?? "",
    email: party?.email ?? "",
    phone: party?.phone ?? "",
    relationship_kind: party?.relationship_kind ?? "",
    relationship: party?.relationship ?? "",
    payment_reason: party?.payment_reason ?? "",
  };
}

/** Whether the server knows step 3's recipient (it sends the key, also as `null`). */
export function knowsRecipient(request: Pick<LeadRequest, "billing">): boolean {
  return request.billing !== undefined && "invoice_recipient" in request.billing;
}

/** The comparable form of a field: what would be sent, as text. */
export function recipientValue(field: keyof RecipientDraft, draft: RecipientDraft): string {
  const value = draft[field].trim();
  return MULTILINE.has(field as RecipientField) ? value : value.replace(/\s+/g, " ");
}

/**
 * Only the answers and fields that differ from the last saved state: a
 * cleared text as `""`, the yes/no answer as `true`, `false` or `null`. A
 * refused value is not sent again until it changes.
 */
export function recipientPatch(
  saved: RecipientDraft,
  draft: RecipientDraft,
  rejected: Partial<Record<keyof RecipientDraft, string>> = {},
): RecipientPatch {
  const patch: RecipientPatch = {};
  for (const field of ["recipient", "is_payer", ...RECIPIENT_FIELDS] as const) {
    const next = recipientValue(field, draft);
    if (next === recipientValue(field, saved) || rejected[field] === next) continue;
    if (field === "recipient") patch.invoice_recipient = next;
    else if (field === "is_payer") patch.invoice_recipient_is_payer = next === "yes" ? true : next === "no" ? false : null;
    else patch[`recipient_${field}`] = next;
  }
  return patch;
}

/** The recipient a saved draft shows, sent with each save (QA 2026-11-03, F2). */
export function recipientExpected(saved: RecipientDraft): { invoice_recipient: string | null; representative_id: string | null } {
  return { invoice_recipient: saved.recipient || null, representative_id: saved.representative_id || null };
}

/** The key of the server for a field of the draft (the one a refusal names). */
export function recipientKey(field: keyof RecipientDraft): string {
  if (field === "recipient") return "invoice_recipient";
  if (field === "is_payer") return "invoice_recipient_is_payer";
  return `recipient_${field}`;
}

/** The field of the draft a key of the server names; `null` for another key. */
export function recipientFieldOf(key: string): keyof RecipientDraft | null {
  if (key === "invoice_recipient") return "recipient";
  if (key === "invoice_recipient_is_payer") return "is_payer";
  if (!key.startsWith("recipient_")) return null;
  const field = key.slice("recipient_".length) as RecipientField;
  return RECIPIENT_FIELDS.includes(field) ? field : null;
}

/** Nothing about a third party: what the patient side as recipient keeps (the e-mail for invoices). */
function withoutParty(draft: RecipientDraft): RecipientDraft {
  return {
    ...draft,
    representative_id: "",
    type: "",
    first_name: "",
    last_name: "",
    organisation_name: "",
    legal_form: "",
    contact_name: "",
    street: "",
    zip: "",
    city: "",
    country: "",
    phone: "",
    relationship_kind: "",
    relationship: "",
    payment_reason: "",
  };
}

/**
 * The draft after "who receives the invoice?": another recipient keeps
 * nothing of the one before. "The recipient is also the payer" is ticked as
 * soon as a recipient is chosen (owner 2026-10-11; the server stores the same
 * default) and keeps an answer given before — but never while a third party
 * is on file as payer (`payerOnFile`; release QA 2026-11-11, F2: choosing "me"
 * ticked "I pay myself" and replaced the payer staff had entered): the patient
 * side then does not pay until the person says so and confirms it. A
 * third-party recipient keeps the default: it replaces the payer only through
 * its own confirmation (`RecipientPayer`), never by being named.
 */
export function withRecipientAnswer(draft: RecipientDraft, answer: string, payerOnFile = false): RecipientDraft {
  if (answer === draft.recipient) return draft;
  const isPayer = !answer ? "" : payerOnFile && answer === "self" ? "no" : draft.is_payer || "yes";
  return { ...withoutParty(draft), recipient: answer, email: "", is_payer: isPayer };
}

/**
 * The third party on file as payer — named by the lead, entered by staff, or
 * answered on the payer's own link or paper questionnaire —, whom nothing but
 * a confirmed answer replaces; `null` when the patient or a parent pays
 * (`parentPays`: the stored third party is the paying parent) or nobody is named.
 * A third-party row that is one of the minor's parents (same e-mail, else the
 * same name and date of birth) is that parent, as the server reads it
 * (`payer_same_person`).
 */
export function thirdPartyPayerOnFile(
  payer: LeadRequestPayer | null | undefined,
  parentPays: boolean,
  representatives: readonly Pick<LeadRequestRepresentative, "slot" | "email" | "first_name" | "last_name" | "date_of_birth">[] = [],
): LeadRequestPayer | null {
  if (!payer || payer.payer_kind !== "third_party" || parentPays) return null;
  const organisation = payer.payer_type != null && payer.payer_type !== "person";
  const address = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
  const parent = !organisation && representatives.some((person) => {
    if (person.slot !== "rep1" && person.slot !== "rep2") return false;
    if (address(person.email) && address(payer.email)) return address(person.email) === address(payer.email);
    return Boolean(person.date_of_birth) && person.date_of_birth === payer.date_of_birth
      && sameName(payerName(payer), [person.first_name, person.last_name].filter(Boolean).join(" "));
  });
  return parent ? null : payer;
}

/** The name of the payer on file for the confirmation: the organisation's or "First Last"; "" without one. */
export function payerOnFileName(payer: LeadRequestPayer | null | undefined): string {
  return payer ? payerName(payer) : "";
}

/**
 * Whether the answer "who pays" puts the patient or a parent in the place of
 * the third party on file: asked before it is sent. Another third party is
 * confirmed where it is named, or on the server's refusal.
 */
export function replacesThirdPartyPayer(
  onFile: LeadRequestPayer | null,
  input: Pick<LeadRequestPayerInput, "payer_kind">,
): boolean {
  return Boolean(onFile) && input.payer_kind !== "third_party";
}

/**
 * "Я (как родитель / законный представитель)" of a parent's login names that
 * parent (owner 2026-10-21): the patient side as recipient without a chosen
 * parent gets the signed-in parent (`ownId`, the representative marked
 * `mine`). A parent chosen before stays.
 */
export function withOwnParent(draft: RecipientDraft, ownId: string | null | undefined): RecipientDraft {
  if (!ownId || draft.recipient !== "self" || draft.representative_id) return draft;
  return { ...draft, representative_id: ownId };
}

/** The draft after "the recipient is": a person has no organisation's data and the other way round. */
export function withRecipientType(draft: RecipientDraft, type: string): RecipientDraft {
  if (type === draft.type) return draft;
  if (type === "organisation") {
    return { ...draft, type, first_name: "", last_name: "", relationship_kind: "", relationship: "" };
  }
  return { ...draft, type, organisation_name: "", legal_form: "", contact_name: "", payment_reason: "" };
}

/** The draft after the relationship was chosen: the words belong to "other" only. */
export function withRecipientRelationship(draft: RecipientDraft, kind: string): RecipientDraft {
  return { ...draft, relationship_kind: kind, relationship: kind === "other" ? draft.relationship : "" };
}

/** The flow's state as the form shows it: which answers are given. */
export type RecipientFlow = {
  recipient: "" | InvoiceRecipient;
  isPayer: "" | "yes" | "no";
};

export function flowOf(draft: Pick<RecipientDraft, "recipient" | "is_payer">): RecipientFlow {
  const recipient = draft.recipient === "self" || draft.recipient === "third_party" ? draft.recipient : "";
  const isPayer = draft.is_payer === "yes" || draft.is_payer === "no" ? draft.is_payer : "";
  return { recipient, isPayer };
}

/**
 * The answers "who pays" offers when the recipient does not pay: the patient
 * himself only with a third-party recipient (a child does not pay, unless an
 * older request says so), the paying parent with a third-party recipient
 * when the parent's own data are on file, a person or an organisation.
 */
export type PayerChoice = "self" | "guardian" | "other_parent" | "person" | "organisation";

export function payerChoices(
  flow: RecipientFlow,
  request: Pick<LeadRequest, "access_kind" | "minor" | "payer">,
  template: PayerSelfTemplate | null | undefined,
): PayerChoice[] {
  const choices: PayerChoice[] = [];
  if (flow.recipient === "third_party") {
    const guardian = request.access_kind === "guardian";
    if (!request.minor || request.payer?.payer_kind === "self") choices.push("self");
    if (guardian && template) choices.push("guardian");
  }
  choices.push("person", "organisation");
  return choices;
}

/**
 * Who pays when a third-party recipient does not (owner 2026-10-11): "the
 * patient" — the patient himself or, for a parent's login, the paying parent
 * — or "another person or organisation", whose data follow.
 */
export type PayerParty = "patient" | "other";

export const PAYER_PARTIES = ["patient", "other"] as const satisfies readonly PayerParty[];

/** The answers of "another person or organisation": what the payer is. */
export const OTHER_PAYER_CHOICES = ["person", "organisation"] as const satisfies readonly PayerChoice[];

/**
 * The answer the stored payer gives: the patient (or the paying parent,
 * `parentPays`) or another person or organisation; "" without a payer.
 */
export function payerPartyOf(payer: LeadRequestPayer | null | undefined, parentPays: boolean): PayerParty | "" {
  if (!payer) return "";
  if (payer.payer_kind === "self" || parentPays) return "patient";
  // The other parent of the minor pays: another person than the signed-in parent.
  if (payer.payer_kind === "representative") return "other";
  return payer.payer_kind === "third_party" ? "other" : "";
}

/** "First Last" or the organisation's name of a recipient draft; "" without one. */
export function recipientName(draft: RecipientDraft): string {
  if (draft.type === "organisation") return draft.organisation_name.trim().replace(/\s+/g, " ");
  return [draft.first_name, draft.last_name]
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join(" ");
}

function sameName(left: string, right: string): boolean {
  return left.trim().replace(/\s+/g, " ").toLowerCase() === right.trim().replace(/\s+/g, " ").toLowerCase();
}

function payerName(payer: LeadRequestPayer): string {
  const organisation = payer.payer_type != null && payer.payer_type !== "person";
  if (organisation) return (payer.organisation_name ?? "").trim();
  return [payer.first_name, payer.last_name]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * Whether the stored payer answers the flow as given (the server's rule):
 * the patient side as recipient who pays — the patient or the paying parent
 * (`parentPays`); as recipient who does not pay — a third party; a
 * third-party recipient who pays — a third party; one who does not pay —
 * the patient or a third party other than the recipient. Otherwise "who
 * pays" is shown unanswered.
 */
export function payerFitsFlow(
  flow: RecipientFlow,
  payer: LeadRequestPayer | null | undefined,
  recipient: RecipientDraft,
  parentPays: boolean,
  representatives: readonly Pick<LeadRequestRepresentative, "id" | "slot" | "email" | "first_name" | "last_name" | "date_of_birth">[] = [],
): boolean {
  if (!payer) return false;
  // A parent named as payer (owner decision 2026-10-19), as the server reads it.
  if (payer.payer_kind === "representative") {
    if (flow.recipient === "self" && recipient.representative_id) {
      const same = payer.payer_representative_id === recipient.representative_id;
      return flow.isPayer === "yes" ? same : flow.isPayer === "no" && !same;
    }
    return (flow.recipient === "self" && flow.isPayer === "yes")
      || (flow.recipient === "third_party" && flow.isPayer === "no");
  }
  const thirdParty = payer.payer_kind === "third_party";
  if (flow.recipient === "self" && recipient.representative_id) {
    const parent = representatives.find((person) => person.id === recipient.representative_id && (person.slot === "rep1" || person.slot === "rep2"));
    if (!parent) return false;
    // The optional invoice delivery address does not identify the payer.
    const same = thirdParty && (payer.payer_type == null || payer.payer_type === "person")
      && (parent.email && payer.email
        ? parent.email.trim().toLowerCase() === payer.email.trim().toLowerCase()
        : Boolean(parent.date_of_birth) && parent.date_of_birth === payer.date_of_birth
          && sameName(payerName(payer), [parent.first_name, parent.last_name].filter(Boolean).join(" ")));
    return flow.isPayer === "yes" ? Boolean(same) : flow.isPayer === "no" && thirdParty && !same;
  }
  if (flow.recipient === "self" && flow.isPayer === "yes") return !thirdParty || parentPays;
  if (flow.recipient === "self" && flow.isPayer === "no") return thirdParty && !parentPays;
  if (flow.recipient === "third_party" && flow.isPayer === "yes") {
    const organisation = payer.payer_type != null && payer.payer_type !== "person";
    const completeName = recipient.type === "organisation" ? Boolean(recipient.organisation_name.trim())
      : Boolean(recipient.first_name.trim() && recipient.last_name.trim());
    return thirdParty && Boolean(recipient.type) && completeName
      && (recipient.type === "organisation") === organisation && sameName(payerName(payer), recipientName(recipient));
  }
  if (flow.recipient === "third_party" && flow.isPayer === "no") {
    if (!thirdParty) return true;
    const name = recipientName(recipient);
    return !name || !sameName(payerName(payer), name);
  }
  return false;
}

/** A complete recipient identity is needed before it can replace the payer. */
export function recipientPayerReady(recipient: RecipientDraft): boolean {
  const named = recipient.type === "organisation"
    ? Boolean(recipient.organisation_name.trim() && recipient.legal_form.trim() && recipient.contact_name.trim())
    : recipient.type === "person" && Boolean(recipient.first_name.trim() && recipient.last_name.trim()
      && recipient.relationship_kind && (recipient.relationship_kind !== "other" || recipient.relationship.trim()) && recipient.phone.trim());
  return named && Boolean(recipient.country && recipient.street.trim() && recipient.zip.trim() && recipient.city.trim() && recipient.email.trim());
}

/**
 * What an organisation that receives the invoice and pays still has to state before it can stand
 * as the payer (`recipientPayerReady`): its legal form and its contact person. The form marks both
 * as required then, but the server asks them only of a payer that is already stored — so nothing
 * was listed and "Next" passed with both empty (release QA 2026-11-11). The step lists and holds
 * them itself. Empty for every other recipient.
 */
export function recipientPayerOpenKeys(recipient: RecipientDraft): RecipientSubmitField[] {
  const flow = flowOf(recipient);
  if (flow.recipient !== "third_party" || flow.isPayer !== "yes" || recipient.type !== "organisation") return [];
  const keys: RecipientSubmitField[] = [];
  if (!recipient.legal_form.trim()) keys.push("recipient_legal_form");
  if (!recipient.contact_name.trim()) keys.push("recipient_contact_name");
  return keys;
}

/** Keys of step 3's recipient in `progress.missing_for_submit`. */
export type RecipientSubmitField =
  | "invoice_recipient"
  | "recipient_representative_id"
  | "invoice_recipient_is_payer"
  | "recipient_type"
  | "recipient_first_name"
  | "recipient_last_name"
  | "recipient_organisation_name"
  | "recipient_legal_form"
  | "recipient_contact_name"
  | "recipient_relationship_kind"
  | "recipient_relationship"
  | "recipient_street"
  | "recipient_zip"
  | "recipient_city"
  | "recipient_country"
  | "recipient_email"
  | "recipient_phone"
  | "recipient_payment_reason";

/** Everything the server can name as missing about the recipient, in form order. */
export const RECIPIENT_SUBMIT_FIELDS: RecipientSubmitField[] = [
  "invoice_recipient",
  "recipient_representative_id",
  "recipient_type",
  "recipient_first_name",
  "recipient_last_name",
  "recipient_organisation_name",
  "recipient_legal_form",
  "recipient_contact_name",
  "recipient_relationship_kind",
  "recipient_relationship",
  "recipient_street",
  "recipient_zip",
  "recipient_city",
  "recipient_country",
  "recipient_email",
  "recipient_phone",
  "recipient_payment_reason",
  "invoice_recipient_is_payer",
];

export function isRecipientField(field: string): field is RecipientSubmitField {
  return (RECIPIENT_SUBMIT_FIELDS as readonly string[]).includes(field);
}
