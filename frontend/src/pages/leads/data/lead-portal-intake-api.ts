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

/** `GET /leads/{id}/portal-intake`: what the patient did in the portal. */
export type LeadPortalIntake = {
  lead_id: string;
  fill_mode: Step1FillMode;
  /** Keys are lead columns: first_name, date_of_birth, street_address, … */
  patient_fields: Record<string, PatientFieldMarker>;
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
