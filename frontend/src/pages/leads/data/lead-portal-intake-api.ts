import { apiFetch } from "@/lib/api";

import { INVOICE_TO_VALUES, PAYMENT_METHODS, type InvoiceTo, type PaymentMethod } from "../model/lead-payer";
import {
  normalizeFollowUpAnswers,
  normalizeRequestReason,
  normalizeStaffIdDataMarks,
  type LeadGwgFollowUpAnswers,
  type LeadPortalRequestReason,
  type LeadStaffIdDataMarks,
} from "../model/lead-risk-intake";

export type Step1FillMode = "staff" | "patient";

/** A step-1 field whose current value the patient entered in the portal. */
export type PatientFieldMarker = { at: string | null; access_kind: "self" | "guardian" | null };

export type LeadPortalConsent = {
  id: string;
  type: string;
  given_at: string | null;
  revoked_at: string | null;
  version: string | null;
  access_kind: string | null;
};

export type LeadPortalUpload = {
  document_id: string;
  uploaded_at: string | null;
  access_kind: string | null;
  reviewed_at: string | null;
  consent_given_at: string | null;
  consent_revoked_at: string | null;
  consent_version: string | null;
};

export type LeadGuardianLink = {
  access_id: string;
  user_id: string;
  trusted_contact_id: string | null;
  name: string | null;
  email: string | null;
  is_active: boolean;
  password_change_pending: boolean;
  last_login_at: string | null;
  created_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
};

export type LeadGuardianCandidate = {
  trusted_contact_id: string | null;
  name: string | null;
  relation: string | null;
  email: string | null;
  access_id: string | null;
};

/**
 * The lead's own GwG statements from the cabinet (place of birth, identity
 * document, PEP, …). Staff read them; they do not edit them.
 */
export type LeadGwgIdentification = {
  /** `mr`, `ms` or `none`. */
  salutation: string | null;
  former_names: string | null;
  birth_place: string | null;
  /** ISO 3166-1 alpha-2, like every country below. */
  birth_country: string | null;
  habitual_residence_country: string | null;
  /** Subset of `email`, `phone`, `messenger`. */
  contact_channels: string[];
  /** `passport`, `id_card` or `residence_permit`. */
  id_document_type: string | null;
  id_document_number: string | null;
  id_issuing_authority: string | null;
  id_issuing_country: string | null;
  /** Calendar dates, `YYYY-MM-DD`. */
  id_issued_on: string | null;
  id_valid_until: string | null;
  /** Yes/no answers: null while the lead has not answered. */
  pep_self: boolean | null;
  pep_self_details: string | null;
  pep_related: boolean | null;
  pep_related_details: string | null;
  high_risk_country: boolean | null;
  high_risk_country_code: string | null;
  sanctions_links: boolean | null;
  sanctions_links_details: string | null;
  payment_background: string | null;
  /** Set by the server when the lead sends the request with the confirmation. */
  declared_correct_at: string | null;
} & LeadStaffIdDataMarks & LeadGwgFollowUpAnswers;

/** A photo or scan of the identity document the lead uploaded in the cabinet. */
export type LeadIdentityDocument = {
  id: string;
  file_name: string;
  uploaded_at: string | null;
  reviewed: boolean;
};

/** Who represents a minor; a request without an answer counts as `joint`. */
export type LeadCustody = "joint" | "sole_parent" | "guardian";

export const LEAD_CUSTODY_VALUES: readonly LeadCustody[] = ["joint", "sole_parent", "guardian"];

/**
 * A person who acts for the lead: a legal representative of a minor (a
 * trusted contact with relation parent / guardian) or an adult's authorised
 * representative or legal guardian (Betreuer). `id` is the id of the trusted
 * contact. Name, date of birth, e-mail and phone are the contact's own values;
 * the rest is what was entered in the cabinet.
 */
export type LeadRepresentative = {
  id: string;
  /** `rep1`, `rep2`, `agent`, `guardian`, or null for a person on file the cabinet does not ask for. */
  slot: string | null;
  /** `legal_representative`, `authorised_representative` or `legal_guardian`. */
  role: string;
  /** The relation of the trusted contact: `parent`, `guardian`, `representative`, … */
  relation: string | null;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  birth_place: string | null;
  birth_country: string | null;
  citizenships: string[];
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  id_document_type: string | null;
  id_document_number: string | null;
  id_issuing_authority: string | null;
  id_issuing_country: string | null;
  id_issued_on: string | null;
  id_valid_until: string | null;
  /** Photos or scans of this person's identity document. */
  identity_documents: LeadIdentityDocument[];
  /** Proofs of the authority to represent (power of attorney, custody order, …). */
  authority_documents: LeadIdentityDocument[];
  /** The person has an active login to the cabinet of this request. */
  has_login: boolean;
  /** GwG data of this person were entered (a `lead_representatives` row exists). */
  has_data: boolean;
  /** `portal` when the cabinet created the trusted contact, `staff` when it existed. */
  contact_origin: string | null;
} & LeadStaffIdDataMarks;

/** Who acts for the lead, as stated in the cabinet (and, for the custody, by staff). */
export type LeadRepresentation = {
  /** Adult: "does somebody act for you?"; null for a minor or while unanswered. */
  has_representative: boolean | null;
  /** Adult: "are you under legal guardianship?"; null for a minor or while unanswered. */
  under_guardianship: boolean | null;
  /** Minor: never null on the server (unanswered counts as `joint`); null for an adult. */
  custody: LeadCustody | null;
  /** False while nobody stated the custody: `custody` is then only the default. */
  custody_stated: boolean;
  representatives: LeadRepresentative[];
};

/**
 * Who answers section 8 (payment route) of the form, as the server computes
 * it for the staff view: `patient` while the patient pays (the lead or a
 * parent answers in the cabinet), `payer` for any third party (the payer is
 * asked through an own link; the keys stay empty until then).
 */
export type LeadPaymentRouteBy = "patient" | "payer";

/**
 * What the server flags for a compliance check from the payment route:
 * cash, crypto, another method, or a payment through a third person or a
 * payment service provider. Shown amber; staff decide.
 */
export const LEAD_COMPLIANCE_FLAGS = ["cash_payment", "crypto_payment", "other_method", "third_party_payment"] as const;

export type LeadComplianceFlag = (typeof LEAD_COMPLIANCE_FLAGS)[number];

/**
 * Sections 7 (invoice recipient) and 8 (payment route) of the GwG form as the
 * lead answered them in the cabinet, plus the two staff fields of the payer
 * declaration (USt-IdNr., Steuernummer) and the compliance flags the server
 * derives. Staff read the answers; they edit only the two staff fields, in
 * the payer section.
 */
export type LeadPortalBilling = {
  /** `self`, `payer` or `other`; null while the lead has not answered. */
  invoice_to: InvoiceTo | null;
  /** Name and address on the invoice; only with `other`. */
  invoice_name: string | null;
  invoice_street: string | null;
  invoice_zip: string | null;
  invoice_city: string | null;
  /** ISO 3166-1 alpha-2. */
  invoice_country: string | null;
  /** E-mail for invoices; only with `self` or `other`. */
  invoice_email: string | null;
  /** Staff fields of the payer declaration. */
  invoice_vat_id: string | null;
  invoice_tax_number: string | null;
  payment_route_by: LeadPaymentRouteBy;
  /** `bank_transfer`, `card`, `cash`, `crypto` or `other`; null while unanswered. */
  payment_method: PaymentMethod | null;
  /** Only with `other`. */
  payment_method_details: string | null;
  /** ISO code; only with `bank_transfer` or `card`. */
  account_country: string | null;
  account_holder: string | null;
  bank_name: string | null;
  /** Payment through a third person or a payment service provider; null while unanswered. */
  via_third_party: boolean | null;
  via_third_party_details: string | null;
  /**
   * Follow-up block C: the total the lead expects to pay, in EUR ("6000.00");
   * null while not answered, absent on an older server.
   */
  expected_total_eur?: string | null;
  compliance_flags: LeadComplianceFlag[];
};

/**
 * The payer's own link in short (contract phase 3a, 4.5): whether the payer
 * answers through a link or in a paying parent's cabinet, the state of the
 * newest link, when it went out, when the payer sent the answers, the check
 * level. Null on an older server and for a role that may not read the
 * statements.
 */
export type LeadPortalPayerLink = {
  mode: "link" | "cabinet" | null;
  /** `sent`, `opened`, `verified`, `submitted`, `expired`, `revoked`, `locked`; null without a link. */
  status: string | null;
  sent_at: string | null;
  submitted_at: string | null;
  check_level: number | null;
};

/** `GET /leads/{id}/portal-intake`: what the patient did in the portal. */
export type LeadPortalIntake = {
  lead_id: string;
  fill_mode: Step1FillMode;
  /** Keys are lead columns: first_name, date_of_birth, street_address, … */
  patient_fields: Record<string, PatientFieldMarker>;
  /** "Who pays" as the patient stated it in the cabinet, while unchanged by staff. */
  patient_payer: PatientFieldMarker | null;
  progress: { filled: number; total: number; documents: number; submitted_at: string | null };
  submitted_at: string | null;
  submitted_by: "self" | "guardian" | null;
  consents: LeadPortalConsent[];
  uploads: LeadPortalUpload[];
  uploads_hidden: boolean;
  guardians: { links: LeadGuardianLink[]; candidates: LeadGuardianCandidate[] };
  minor: boolean;
  can_issue: boolean;
  /** The caller may mark patient uploads as reviewed (leads.edit + medical access). */
  can_review_uploads: boolean;
  /** The lead's own GwG statements; null when the server does not send them. */
  identification: LeadGwgIdentification | null;
  /** Last change of these statements by the lead; null when nothing was entered. */
  identification_updated_at: string | null;
  /** The caller's role may not read the statements; they come empty then. */
  identification_hidden: boolean;
  identity_documents: LeadIdentityDocument[];
  /**
   * Who acts for the lead; null when the server does not send it (an older
   * backend, or a role that may not read the payer block).
   */
  representation: LeadRepresentation | null;
  /** Last change of the representation by the lead or a parent; null when nothing was entered. */
  representation_updated_at: string | null;
  /**
   * Invoice recipient and payment route (sections 7–8 of the form); null when
   * the server does not send them (an older backend, or a role that may not
   * read the payer block).
   */
  billing: LeadPortalBilling | null;
  /** Last change of sections 7–8 by the lead while nobody changed the stored answers since. */
  billing_updated_at: string | null;
  /** The payer's own link in short; null on an older server or for a role that may not read it. */
  payer_link: LeadPortalPayerLink | null;
  /**
   * The answers of the cabinet's extra step "Zusätzliche Angaben" (two-stage
   * form 2026-10-07) with the self-payer's proofs; null on an older server or
   * for a role that may not read the payer block.
   */
  enhanced_details?: LeadPortalEnhancedDetails | null;
  /**
   * The lead changed answers after sending and has not sent again (the same
   * meaning as in the lead's own request); null on an older server.
   */
  changed_since_submit?: boolean | null;
  /** The lead's own reason for the request (trigger flow 13.1); null when nothing was entered. */
  request_reason?: LeadPortalRequestReason | null;
};

/** Which questions the cabinet's extra step asks (the server's `ExtraQuestions`). */
export type LeadEnhancedDetailsAsks = {
  payment_background: boolean;
  payer_funds: boolean;
  funds: boolean;
  occupation: boolean;
  sector: boolean;
  funds_proof: boolean;
  payer_states_funds: boolean;
};

/**
 * The extra step "Zusätzliche Angaben" of the lead's cabinet as staff read
 * it (block A / B answers of the trigger flow): whether the step is shown
 * (`required`), whether the enhanced check requires it (`check_required`),
 * which questions it asks, the answers — the self-payer's own source of funds
 * (one choice) with the words, what the patient knows of a third party's funds
 * ("со слов пациента"), profession and sector — and the self-payer's proofs.
 * "Why the third party pays" is `identification.payment_background`.
 */
export type LeadPortalEnhancedDetails = {
  required: boolean;
  check_required: boolean;
  asks: LeadEnhancedDetailsAsks;
  answers: {
    /** The self-payer's sources: one choice today (`funds_source`), a list once the cabinet asks several. */
    funds_sources: string[];
    funds_description: string | null;
    payer_funds_source: string | null;
    payer_funds_description: string | null;
    occupation: string | null;
    sector: string | null;
  };
  funds_proof_documents: LeadIdentityDocument[];
  /** Last change by the lead while the answers are still what the lead entered. */
  updated_at: string | null;
};

export type LeadGuardianAccessIssued = {
  access_id: string;
  user_id: string;
  email: string;
  created: boolean;
  reused: boolean;
  one_time_password: string | null;
};

const base = (leadId: string) => `/leads/${encodeURIComponent(leadId)}`;

/** The portal state, or null when the answer is not one (e.g. an older backend). */
export async function fetchLeadPortalIntake(leadId: string): Promise<LeadPortalIntake | null> {
  const value = await apiFetch<unknown>(`${base(leadId)}/portal-intake`, { forceFresh: true });
  return normalizeLeadPortalIntake(value);
}

export function normalizeLeadPortalIntake(value: unknown): LeadPortalIntake | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<LeadPortalIntake>;
  if (typeof raw.lead_id !== "string") return null;
  return {
    lead_id: raw.lead_id,
    fill_mode: raw.fill_mode === "patient" ? "patient" : "staff",
    patient_fields: raw.patient_fields && typeof raw.patient_fields === "object" ? raw.patient_fields : {},
    patient_payer: raw.patient_payer && typeof raw.patient_payer === "object" ? raw.patient_payer : null,
    progress: raw.progress ?? { filled: 0, total: 0, documents: 0, submitted_at: null },
    submitted_at: raw.submitted_at ?? null,
    submitted_by: raw.submitted_by ?? null,
    consents: Array.isArray(raw.consents) ? raw.consents : [],
    uploads: Array.isArray(raw.uploads) ? raw.uploads : [],
    uploads_hidden: Boolean(raw.uploads_hidden),
    guardians: {
      links: Array.isArray(raw.guardians?.links) ? raw.guardians.links : [],
      candidates: Array.isArray(raw.guardians?.candidates) ? raw.guardians.candidates : [],
    },
    minor: Boolean(raw.minor),
    can_issue: Boolean(raw.can_issue),
    can_review_uploads: Boolean(raw.can_review_uploads),
    identification: normalizeIdentification(raw.identification),
    identification_updated_at: textOrNull(raw.identification_updated_at),
    identification_hidden: Boolean(raw.identification_hidden),
    identity_documents: normalizeIdentityDocuments(raw.identity_documents),
    representation: normalizeLeadRepresentation(raw.representation),
    representation_updated_at: textOrNull(raw.representation_updated_at),
    billing: normalizeLeadPortalBilling(raw.billing),
    billing_updated_at: textOrNull(raw.billing_updated_at),
    payer_link: normalizeLeadPortalPayerLink((raw as Record<string, unknown>).payer_link),
    enhanced_details: normalizeLeadPortalEnhancedDetails((raw as Record<string, unknown>).enhanced_details),
    changed_since_submit: answerOrNull((raw as Record<string, unknown>).changed_since_submit),
    request_reason: normalizeRequestReason(raw as Record<string, unknown>),
  };
}

/** The extra step's answers with every key present; null when the server sent none. */
export function normalizeLeadPortalEnhancedDetails(value: unknown): LeadPortalEnhancedDetails | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const asks = asRecord(raw.asks) ?? {};
  const answers = asRecord(raw.answers) ?? {};
  const listed = Array.isArray(answers.funds_sources)
    ? answers.funds_sources.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
  const single = textOrNull(answers.funds_source);
  return {
    required: raw.required === true,
    check_required: raw.check_required === true,
    asks: {
      payment_background: asks.payment_background === true,
      payer_funds: asks.payer_funds === true,
      funds: asks.funds === true,
      occupation: asks.occupation === true,
      sector: asks.sector === true,
      funds_proof: asks.funds_proof === true,
      payer_states_funds: asks.payer_states_funds === true,
    },
    answers: {
      funds_sources: listed.length > 0 ? listed : single ? [single] : [],
      funds_description: textOrNull(answers.funds_description),
      payer_funds_source: textOrNull(answers.payer_funds_source),
      payer_funds_description: textOrNull(answers.payer_funds_description),
      occupation: textOrNull(answers.occupation),
      sector: textOrNull(answers.sector),
    },
    funds_proof_documents: normalizeIdentityDocuments(raw.funds_proof_documents),
    updated_at: textOrNull(raw.updated_at),
  };
}

/** The payer link in short with every key present; null when the server sent none. */
export function normalizeLeadPortalPayerLink(value: unknown): LeadPortalPayerLink | null {
  const raw = asRecord(value);
  if (!raw) return null;
  return {
    mode: raw.mode === "link" || raw.mode === "cabinet" ? raw.mode : null,
    status: textOrNull(raw.status),
    sent_at: textOrNull(raw.sent_at),
    submitted_at: textOrNull(raw.submitted_at),
    check_level: typeof raw.check_level === "number" ? raw.check_level : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const textOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const answerOrNull = (value: unknown) => (typeof value === "boolean" ? value : null);

/** The lead's statements with every key present; null when the server sent none. */
function normalizeIdentification(value: unknown): LeadGwgIdentification | null {
  const raw = asRecord(value);
  if (!raw) return null;
  return {
    salutation: textOrNull(raw.salutation),
    former_names: textOrNull(raw.former_names),
    birth_place: textOrNull(raw.birth_place),
    birth_country: textOrNull(raw.birth_country),
    habitual_residence_country: textOrNull(raw.habitual_residence_country),
    contact_channels: Array.isArray(raw.contact_channels)
      ? raw.contact_channels.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      : [],
    id_document_type: textOrNull(raw.id_document_type),
    id_document_number: textOrNull(raw.id_document_number),
    id_issuing_authority: textOrNull(raw.id_issuing_authority),
    id_issuing_country: textOrNull(raw.id_issuing_country),
    id_issued_on: textOrNull(raw.id_issued_on),
    id_valid_until: textOrNull(raw.id_valid_until),
    pep_self: answerOrNull(raw.pep_self),
    pep_self_details: textOrNull(raw.pep_self_details),
    pep_related: answerOrNull(raw.pep_related),
    pep_related_details: textOrNull(raw.pep_related_details),
    high_risk_country: answerOrNull(raw.high_risk_country),
    high_risk_country_code: textOrNull(raw.high_risk_country_code),
    sanctions_links: answerOrNull(raw.sanctions_links),
    sanctions_links_details: textOrNull(raw.sanctions_links_details),
    payment_background: textOrNull(raw.payment_background),
    declared_correct_at: textOrNull(raw.declared_correct_at),
    ...normalizeStaffIdDataMarks(raw),
    ...normalizeFollowUpAnswers(raw),
  };
}

function normalizeIdentityDocuments(value: unknown): LeadIdentityDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const raw = asRecord(item);
    if (!raw || typeof raw.id !== "string") return [];
    return [
      {
        id: raw.id,
        file_name: textOrNull(raw.file_name) ?? "",
        uploaded_at: textOrNull(raw.uploaded_at),
        reviewed: raw.reviewed === true,
      },
    ];
  });
}

function normalizeRepresentative(value: unknown): LeadRepresentative | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.id !== "string" || !raw.id.trim()) return null;
  return {
    id: raw.id.trim(),
    slot: textOrNull(raw.slot),
    role: textOrNull(raw.role) ?? "legal_representative",
    relation: textOrNull(raw.relation),
    first_name: textOrNull(raw.first_name),
    last_name: textOrNull(raw.last_name),
    date_of_birth: textOrNull(raw.date_of_birth),
    birth_place: textOrNull(raw.birth_place),
    birth_country: textOrNull(raw.birth_country),
    citizenships: Array.isArray(raw.citizenships)
      ? raw.citizenships.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      : [],
    street: textOrNull(raw.street),
    zip: textOrNull(raw.zip),
    city: textOrNull(raw.city),
    country: textOrNull(raw.country),
    email: textOrNull(raw.email),
    phone: textOrNull(raw.phone),
    id_document_type: textOrNull(raw.id_document_type),
    id_document_number: textOrNull(raw.id_document_number),
    id_issuing_authority: textOrNull(raw.id_issuing_authority),
    id_issuing_country: textOrNull(raw.id_issuing_country),
    id_issued_on: textOrNull(raw.id_issued_on),
    id_valid_until: textOrNull(raw.id_valid_until),
    identity_documents: normalizeIdentityDocuments(raw.identity_documents),
    authority_documents: normalizeIdentityDocuments(raw.authority_documents),
    has_login: raw.has_login === true,
    has_data: raw.has_data === true,
    contact_origin: textOrNull(raw.contact_origin),
    ...normalizeStaffIdDataMarks(raw),
  };
}

/**
 * Who acts for the lead, with every key present; null when the server sent
 * none (an older backend, or a role that may not read it).
 */
export function normalizeLeadRepresentation(value: unknown): LeadRepresentation | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const custody = LEAD_CUSTODY_VALUES.find((item) => item === raw.custody) ?? null;
  return {
    has_representative: answerOrNull(raw.has_representative),
    under_guardianship: answerOrNull(raw.under_guardianship),
    custody,
    custody_stated: custody !== null && raw.custody_stated === true,
    representatives: Array.isArray(raw.representatives)
      ? raw.representatives.flatMap((item) => {
          const representative = normalizeRepresentative(item);
          return representative ? [representative] : [];
        })
      : [],
  };
}

/**
 * Sections 7–8 with every key present; null when the server sent none (an
 * older backend, or a role that may not read them). An unknown enum value
 * reads as "not answered"; an unknown flag is dropped.
 */
export function normalizeLeadPortalBilling(value: unknown): LeadPortalBilling | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const flags: unknown[] = Array.isArray(raw.compliance_flags) ? raw.compliance_flags : [];
  return {
    invoice_to: INVOICE_TO_VALUES.find((item) => item === raw.invoice_to) ?? null,
    invoice_name: textOrNull(raw.invoice_name),
    invoice_street: textOrNull(raw.invoice_street),
    invoice_zip: textOrNull(raw.invoice_zip),
    invoice_city: textOrNull(raw.invoice_city),
    invoice_country: textOrNull(raw.invoice_country),
    invoice_email: textOrNull(raw.invoice_email),
    invoice_vat_id: textOrNull(raw.invoice_vat_id),
    invoice_tax_number: textOrNull(raw.invoice_tax_number),
    payment_route_by: raw.payment_route_by === "payer" ? "payer" : "patient",
    payment_method: PAYMENT_METHODS.find((item) => item === raw.payment_method) ?? null,
    payment_method_details: textOrNull(raw.payment_method_details),
    account_country: textOrNull(raw.account_country),
    account_holder: textOrNull(raw.account_holder),
    bank_name: textOrNull(raw.bank_name),
    via_third_party: answerOrNull(raw.via_third_party),
    via_third_party_details: textOrNull(raw.via_third_party_details),
    expected_total_eur:
      raw.expected_total_eur === undefined
        ? undefined
        : typeof raw.expected_total_eur === "number" && Number.isFinite(raw.expected_total_eur)
          ? raw.expected_total_eur.toFixed(2)
          : textOrNull(raw.expected_total_eur),
    compliance_flags: LEAD_COMPLIANCE_FLAGS.filter((flag) => flags.includes(flag)),
  };
}

export function setLeadStep1FillMode(leadId: string, mode: Step1FillMode): Promise<{ fill_mode: Step1FillMode }> {
  return apiFetch(`${base(leadId)}/portal-intake/fill-mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export function reviewLeadPortalUpload(leadId: string, documentId: string): Promise<{ reviewed_at: string }> {
  return apiFetch(`${base(leadId)}/portal-intake/documents/${encodeURIComponent(documentId)}/review`, {
    method: "POST",
  });
}

export function issueLeadGuardianAccess(leadId: string, trustedContactId: string): Promise<LeadGuardianAccessIssued> {
  return apiFetch<LeadGuardianAccessIssued>(`${base(leadId)}/portal-guardians`, {
    method: "POST",
    body: JSON.stringify({ trusted_contact_id: trustedContactId }),
  });
}

export function resetLeadGuardianPassword(leadId: string, accessId: string): Promise<LeadGuardianAccessIssued> {
  return apiFetch<LeadGuardianAccessIssued>(
    `${base(leadId)}/portal-guardians/${encodeURIComponent(accessId)}/password`,
    { method: "POST" },
  );
}

export function revokeLeadGuardianAccess(leadId: string, accessId: string): Promise<{ login_deactivated: boolean }> {
  return apiFetch(`${base(leadId)}/portal-guardians/${encodeURIComponent(accessId)}/revoke`, {
    method: "POST",
  });
}
