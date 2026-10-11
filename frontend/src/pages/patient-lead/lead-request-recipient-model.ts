import type {
  InvoiceRecipient,
  LeadRequest,
  LeadRequestBilling,
  LeadRequestPayer,
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
 * default) and keeps an answer given before.
 */
export function withRecipientAnswer(draft: RecipientDraft, answer: string): RecipientDraft {
  if (answer === draft.recipient) return draft;
  return { ...withoutParty(draft), recipient: answer, email: "", is_payer: answer ? draft.is_payer || "yes" : "" };
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
export type PayerChoice = "self" | "guardian" | "person" | "organisation";

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
): boolean {
  if (!payer) return false;
  const thirdParty = payer.payer_kind === "third_party";
  if (flow.recipient === "self" && flow.isPayer === "yes") return !thirdParty || parentPays;
  if (flow.recipient === "self" && flow.isPayer === "no") return thirdParty && !parentPays;
  if (flow.recipient === "third_party" && flow.isPayer === "yes") return thirdParty;
  if (flow.recipient === "third_party" && flow.isPayer === "no") {
    if (!thirdParty) return true;
    const name = recipientName(recipient);
    return !name || !sameName(payerName(payer), name);
  }
  return false;
}

/** Keys of step 3's recipient in `progress.missing_for_submit`. */
export type RecipientSubmitField =
  | "invoice_recipient"
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
