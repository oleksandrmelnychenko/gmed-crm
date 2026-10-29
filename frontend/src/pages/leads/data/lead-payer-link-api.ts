import { apiFetch } from "@/lib/api";

/**
 * The payer's own link (contract phase 3a): a one-time link without an
 * account that GMED sends to a third-party payer, and the payer's answers
 * (the questionnaire). Staff read the state and the answers, send, resend and
 * revoke the link and enter the expected total amount.
 */

/** Languages of the invitation e-mail and of the payer page. */
export const PAYER_LINK_LANGUAGES = ["de", "en", "uk", "ru"] as const;

export type PayerLinkLanguage = (typeof PAYER_LINK_LANGUAGES)[number];

/** `link` for a third party; `cabinet` for a paying parent with a cabinet login (asked there). */
export type PayerLinkMode = "link" | "cabinet";

/** Why the link cannot be sent now (contract D3). */
export const PAYER_LINK_BLOCKED_REASONS = [
  "request_not_submitted",
  "no_third_party",
  "contact_consent_missing",
  "payer_email_missing",
  "payer_has_cabinet_login",
  // A minor's parent pays as the contracting party: never a payer's link (2026-10-19).
  "payer_is_representative",
  "lead_converted",
] as const;

export type PayerLinkBlockedReason = (typeof PAYER_LINK_BLOCKED_REASONS)[number];

export const PAYER_LINK_STATUSES = ["prepared", "sent", "opened", "verified", "submitted", "expired", "revoked", "locked"] as const;

export type PayerLinkStatus = (typeof PAYER_LINK_STATUSES)[number];

/** Why a link was revoked: resent, by staff, another payer or e-mail, the lead converted, the e-mail failed. */
export const PAYER_LINK_REVOKE_REASONS = [
  "resent",
  "staff_revoked",
  "payer_changed",
  "email_changed",
  "lead_converted",
  "email_failed",
] as const;

/** The newest link of the lead, revoked or not. */
export type PayerLinkInfo = {
  id?: string | null;
  created_at?: string | null;
  status: PayerLinkStatus;
  email: string | null;
  language: PayerLinkLanguage | null;
  sent_at: string | null;
  sent_by_name: string | null;
  expires_at: string | null;
  opened_at: string | null;
  verified_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  /** How the last e-mail of the link went out (invitation or code). */
  last_email_status: "sent" | "failed" | null;
  /** The newest invitation and code e-mail with their delivery (2026-10-24). */
  emails: PayerLinkEmail[];
};

export const PAYER_LINK_DELIVERY_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "deferred",
  "bounced",
  "failed",
  "suppressed",
  "complained",
  "unknown",
] as const;
export type PayerLinkDeliveryStatus = (typeof PAYER_LINK_DELIVERY_STATUSES)[number];

/** One e-mail of the link: whether Mittaro took it and what it reported later. */
export type PayerLinkEmail = {
  kind: "invitation" | "code";
  status: "sent" | "failed";
  sent_at: string | null;
  delivery_status: PayerLinkDeliveryStatus | null;
  delivery_updated_at: string | null;
};

/** A beneficial owner of a company payer (share in percent as a decimal string). */
export type PayerBeneficialOwner = {
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  birth_place: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  share_percent: string | null;
};

/** The payer's answers (contract 2.3): effective values, the keys of the other payer type null. */
export type PayerQuestionnaireAnswers = {
  salutation: string | null;
  first_name: string | null;
  last_name: string | null;
  former_names: string | null;
  date_of_birth: string | null;
  birth_place: string | null;
  birth_country: string | null;
  citizenships: string[];
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  habitual_residence_country: string | null;
  phone: string | null;
  language: string | null;
  id_document_type: string | null;
  id_document_number: string | null;
  id_issuing_authority: string | null;
  id_issuing_country: string | null;
  id_issued_on: string | null;
  id_valid_until: string | null;
  organisation_name: string | null;
  legal_form: string | null;
  vat_id: string | null;
  payment_reason: string | null;
  register_court: string | null;
  register_number: string | null;
  representative_first_name: string | null;
  representative_last_name: string | null;
  representative_role: string | null;
  beneficial_owners: PayerBeneficialOwner[];
  beneficial_owners_none: boolean | null;
  relationship_kind: string | null;
  relationship: string | null;
  occupation: string | null;
  industry: string | null;
  funds_sources: string[];
  funds_description: string | null;
  pep_self: boolean | null;
  pep_self_details: string | null;
  pep_related: boolean | null;
  pep_related_details: string | null;
  high_risk_country: boolean | null;
  high_risk_country_code: string | null;
  sanctions_links: boolean | null;
  sanctions_links_details: string | null;
};

/** An upload of the payer (identity document or proof of the source of funds). */
export type PayerQuestionnaireDocument = {
  id: string;
  file_name: string;
  size_bytes: number | null;
  mime_type: string | null;
  uploaded_at: string | null;
  reviewed: boolean;
  can_delete: boolean;
};

/** Section 8 of the form as the payer answers it. */
export type PayerPaymentRoute = {
  payment_method: string | null;
  payment_method_details: string | null;
  account_country: string | null;
  account_holder: string | null;
  bank_name: string | null;
  via_third_party: boolean | null;
  via_third_party_details: string | null;
  /** False in the cabinet variant: phase 2 asks the paying parent there. */
  asked: boolean;
};

/** The questionnaire as staff read it (contract 3.5 plus the staff keys of 4.2). */
export type StaffPayerQuestionnaire = {
  patient_name: string | null;
  /** `link` (answered through the link) or `cabinet` (the paying parent). */
  source: string | null;
  /** `person`, `company`, `organisation` or `insurance`. */
  payer_type: string;
  /** `draft` or `submitted`. */
  state: string | null;
  email: string | null;
  email_confirmed_at: string | null;
  privacy: {
    acknowledged_at: string | null;
    text_version: string | null;
    contact_channels: string[];
    ip: string | null;
  };
  answers: PayerQuestionnaireAnswers;
  payment_route: PayerPaymentRoute | null;
  identity_documents: PayerQuestionnaireDocument[];
  funds_proof_documents: PayerQuestionnaireDocument[];
  funds_proof_required: boolean;
  missing_for_submit: string[];
  declared_correct_at: string | null;
  submitted_at: string | null;
  /** 1 or 2 (2: the enhanced check is required); null on a server that does not send it. */
  check_level: number | null;
  /** The keys of the enhanced check (owner rule 2026-10-07), see `enhancedCheckReasonLabel`. */
  check_reasons: string[];
  updated_at: string | null;
  adopted_at: string | null;
};

export type PayerLinkRiskHold = "review" | "rejected";

/** Why a previous payer's statement was superseded: another payer, or the same payer at another e-mail address. */
export type PayerPreviousQuestionnaireReason = "payer_changed" | "email_changed";

/**
 * The sent questionnaire of a previous payer (QA 2026-10-25, map item 95):
 * archived when staff changed the payer or its address, named here with dates
 * only — its answers stay in the archive. `document_id` is the archived copy
 * of that payer's identity document ("Früherer Zahler – …"), if one was
 * uploaded.
 */
export type PayerPreviousQuestionnaire = {
  statement_id: string;
  payer_name: string | null;
  /** `third_party` or `representative`: the declaration's payer kind. */
  payer_kind: string | null;
  /** `person`, `company`, `organisation` or `insurance`. */
  payer_type: string | null;
  submitted_at: string | null;
  archived_at: string | null;
  archived_reason: PayerPreviousQuestionnaireReason | null;
  document_id: string | null;
};

/** `GET /leads/{id}/payer-link`. */
export type LeadPayerLinkState = {
  mode: PayerLinkMode | null;
  can_send: boolean;
  can_prepare?: boolean;
  blocked_reason: string | null;
  /**
   * The risk assessment holds the link: `review` at level 3 until a decision
   * or a request of block D, `rejected` after a reject; null (or absent on an
   * older server) while it may go out.
   */
  risk_hold?: PayerLinkRiskHold | null;
  /** E-mail sending (Mittaro) is set up. */
  mail_available: boolean;
  link: PayerLinkInfo | null;
  questionnaire: StaffPayerQuestionnaire | null;
  /** The sent statements of previous payers, newest first; empty on an older server. */
  previous_questionnaires: PayerPreviousQuestionnaire[];
};

/** The body of "send" and "resend": the language of the e-mail and the page, and whether a submitted questionnaire is reopened. */
export type PayerLinkSendInput = { language: PayerLinkLanguage; reopen: boolean; token?: string };

const base = (leadId: string) => `/leads/${encodeURIComponent(leadId)}/payer-link`;

/** The state of the payer link; null when the answer is not one (an older backend behind a catch-all). */
export async function fetchLeadPayerLink(leadId: string): Promise<LeadPayerLinkState | null> {
  return normalizeLeadPayerLinkState(await apiFetch<unknown>(base(leadId), { forceFresh: true }));
}

/** Sends the link, or a new one in place of the active link. */
export async function sendLeadPayerLink(leadId: string, input: PayerLinkSendInput): Promise<LeadPayerLinkState | null> {
  return normalizeLeadPayerLinkState(
    await apiFetch<unknown>(base(leadId), { method: "POST", body: JSON.stringify(input) }),
  );
}

/** Revokes the active link; the answers stay. */
export async function revokeLeadPayerLink(leadId: string): Promise<LeadPayerLinkState | null> {
  return normalizeLeadPayerLinkState(await apiFetch<unknown>(`${base(leadId)}/revoke`, { method: "POST" }));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const textOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const answerOrNull = (value: unknown) => (typeof value === "boolean" ? value : null);
const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];

/** A decimal as the server sends it: a string, or a number from an older or other serializer. */
function decimalOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  return textOrNull(value);
}

function oneOf<Value extends string>(values: readonly Value[], value: unknown): Value | null {
  return values.find((item) => item === value) ?? null;
}

function normalizeLink(value: unknown): PayerLinkInfo | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const status = oneOf(PAYER_LINK_STATUSES, raw.status);
  if (!status) return null;
  return {
    status,
    id: textOrNull(raw.id),
    created_at: textOrNull(raw.created_at),
    email: textOrNull(raw.email),
    language: oneOf(PAYER_LINK_LANGUAGES, raw.language),
    sent_at: textOrNull(raw.sent_at),
    sent_by_name: textOrNull(raw.sent_by_name),
    expires_at: textOrNull(raw.expires_at),
    opened_at: textOrNull(raw.opened_at),
    verified_at: textOrNull(raw.verified_at),
    revoked_at: textOrNull(raw.revoked_at),
    revoked_reason: textOrNull(raw.revoked_reason),
    last_email_status: raw.last_email_status === "sent" || raw.last_email_status === "failed" ? raw.last_email_status : null,
    emails: Array.isArray(raw.emails) ? raw.emails.map(normalizeLinkEmail).filter((email) => email !== null) : [],
  };
}

function normalizeLinkEmail(value: unknown): PayerLinkEmail | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const kind = raw.kind === "invitation" || raw.kind === "code" ? raw.kind : null;
  const status = raw.status === "sent" || raw.status === "failed" ? raw.status : null;
  if (!kind || !status) return null;
  return {
    kind,
    status,
    sent_at: textOrNull(raw.sent_at),
    delivery_status: oneOf(PAYER_LINK_DELIVERY_STATUSES, raw.delivery_status),
    delivery_updated_at: textOrNull(raw.delivery_updated_at),
  };
}

function normalizeOwner(value: unknown): PayerBeneficialOwner | null {
  const raw = asRecord(value);
  if (!raw) return null;
  return {
    first_name: textOrNull(raw.first_name),
    last_name: textOrNull(raw.last_name),
    date_of_birth: textOrNull(raw.date_of_birth),
    birth_place: textOrNull(raw.birth_place),
    street: textOrNull(raw.street),
    zip: textOrNull(raw.zip),
    city: textOrNull(raw.city),
    country: textOrNull(raw.country),
    share_percent: decimalOrNull(raw.share_percent),
  };
}

const TEXT_ANSWER_KEYS = [
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
  "legal_form",
  "vat_id",
  "payment_reason",
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
] as const satisfies readonly (keyof PayerQuestionnaireAnswers)[];

/** The answers with every key present; an absent object reads as "nothing answered". */
export function normalizePayerAnswers(value: unknown): PayerQuestionnaireAnswers {
  const raw = asRecord(value) ?? {};
  const text = Object.fromEntries(TEXT_ANSWER_KEYS.map((key) => [key, textOrNull(raw[key])])) as Pick<
    PayerQuestionnaireAnswers,
    (typeof TEXT_ANSWER_KEYS)[number]
  >;
  return {
    ...text,
    citizenships: stringList(raw.citizenships),
    beneficial_owners: Array.isArray(raw.beneficial_owners)
      ? raw.beneficial_owners.flatMap((item) => {
          const owner = normalizeOwner(item);
          return owner ? [owner] : [];
        })
      : [],
    beneficial_owners_none: answerOrNull(raw.beneficial_owners_none),
    funds_sources: stringList(raw.funds_sources),
    pep_self: answerOrNull(raw.pep_self),
    pep_related: answerOrNull(raw.pep_related),
    high_risk_country: answerOrNull(raw.high_risk_country),
    sanctions_links: answerOrNull(raw.sanctions_links),
  };
}

export function normalizePayerDocuments(value: unknown): PayerQuestionnaireDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = asRecord(item);
    if (!raw || typeof raw.id !== "string" || !raw.id.trim()) return [];
    return [
      {
        id: raw.id,
        file_name: textOrNull(raw.file_name) ?? "",
        size_bytes: typeof raw.size_bytes === "number" ? raw.size_bytes : null,
        mime_type: textOrNull(raw.mime_type),
        uploaded_at: textOrNull(raw.uploaded_at),
        reviewed: raw.reviewed === true,
        can_delete: raw.can_delete === true,
      },
    ];
  });
}

function normalizePaymentRoute(value: unknown): PayerPaymentRoute | null {
  const raw = asRecord(value);
  if (!raw) return null;
  return {
    payment_method: textOrNull(raw.payment_method),
    payment_method_details: textOrNull(raw.payment_method_details),
    account_country: textOrNull(raw.account_country),
    account_holder: textOrNull(raw.account_holder),
    bank_name: textOrNull(raw.bank_name),
    via_third_party: answerOrNull(raw.via_third_party),
    via_third_party_details: textOrNull(raw.via_third_party_details),
    asked: raw.asked !== false,
  };
}

/** The staff view of the questionnaire; null when the server sent none. */
export function normalizeStaffPayerQuestionnaire(value: unknown): StaffPayerQuestionnaire | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const privacy = asRecord(raw.privacy) ?? {};
  const level = typeof raw.check_level === "number" ? raw.check_level : null;
  return {
    patient_name: textOrNull(raw.patient_name),
    source: textOrNull(raw.source),
    payer_type: textOrNull(raw.payer_type) ?? "person",
    state: textOrNull(raw.state),
    email: textOrNull(raw.email),
    email_confirmed_at: textOrNull(raw.email_confirmed_at),
    privacy: {
      acknowledged_at: textOrNull(privacy.acknowledged_at),
      text_version: textOrNull(privacy.text_version),
      contact_channels: stringList(privacy.contact_channels),
      ip: textOrNull(privacy.ip),
    },
    answers: normalizePayerAnswers(raw.answers),
    payment_route: normalizePaymentRoute(raw.payment_route),
    identity_documents: normalizePayerDocuments(raw.identity_documents),
    funds_proof_documents: normalizePayerDocuments(raw.funds_proof_documents),
    funds_proof_required: raw.funds_proof_required === true,
    missing_for_submit: stringList(raw.missing_for_submit),
    declared_correct_at: textOrNull(raw.declared_correct_at),
    submitted_at: textOrNull(raw.submitted_at),
    check_level: level === 1 || level === 2 ? level : null,
    check_reasons: stringList(raw.check_reasons),
    updated_at: textOrNull(raw.updated_at),
    adopted_at: textOrNull(raw.adopted_at),
  };
}

/**
 * The state with every key present; null for anything that is not one (an
 * older backend, or a proxy reply), so the panel stays away.
 */
export function normalizeLeadPayerLinkState(value: unknown): LeadPayerLinkState | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.can_send !== "boolean") return null;
  return {
    mode: raw.mode === "link" || raw.mode === "cabinet" ? raw.mode : null,
    can_send: raw.can_send,
    can_prepare: raw.can_prepare === true,
    blocked_reason: textOrNull(raw.blocked_reason),
    risk_hold: raw.risk_hold === "review" || raw.risk_hold === "rejected" ? raw.risk_hold : null,
    mail_available: raw.mail_available !== false,
    link: normalizeLink(raw.link),
    questionnaire: normalizeStaffPayerQuestionnaire(raw.questionnaire),
    previous_questionnaires: normalizePreviousQuestionnaires(raw.previous_questionnaires),
  };
}

/** The previous payers' statements as the server lists them (newest first); none on an older server. */
export function normalizePreviousQuestionnaires(value: unknown): PayerPreviousQuestionnaire[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = asRecord(item);
    const id = raw ? textOrNull(raw.statement_id) : null;
    if (!raw || !id) return [];
    return [
      {
        statement_id: id,
        payer_name: textOrNull(raw.payer_name),
        payer_kind: textOrNull(raw.payer_kind),
        payer_type: textOrNull(raw.payer_type),
        submitted_at: textOrNull(raw.submitted_at),
        archived_at: textOrNull(raw.archived_at),
        archived_reason:
          raw.archived_reason === "payer_changed" || raw.archived_reason === "email_changed" ? raw.archived_reason : null,
        document_id: textOrNull(raw.document_id),
      },
    ];
  });
}

/** Kept only in component memory; never stored in query caches or browser storage. */
export type PayerLinkShare = {
  id: string;
  token: string;
  url: string;
  email: string;
  expires_at: string;
  messages: Record<PayerLinkLanguage, string>;
};

export async function prepareLeadPayerLink(leadId: string, input: PayerLinkSendInput): Promise<PayerLinkShare> {
  const raw = asRecord(await apiFetch<unknown>(base(leadId), {
    method: "POST", body: JSON.stringify({ language: input.language, reopen: input.reopen, delivery: "manual" }),
  }));
  const messages = asRecord(raw?.messages);
  if (!raw || !messages || !["id", "token", "url", "email", "expires_at"].every((key) => typeof raw[key] === "string" && raw[key])
    || !PAYER_LINK_LANGUAGES.every((language) => typeof messages[language] === "string" && messages[language])) {
    throw new Error("Invalid payer invitation response");
  }
  return raw as PayerLinkShare;
}
