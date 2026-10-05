import { apiFetch } from "@/lib/api";

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
};

/** A photo or scan of the identity document the lead uploaded in the cabinet. */
export type LeadIdentityDocument = {
  id: string;
  file_name: string;
  uploaded_at: string | null;
  reviewed: boolean;
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
