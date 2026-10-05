import { apiFetch } from "@/lib/api";

/** Consent to process the uploaded health documents (Art. 9 DSGVO), before the first upload. */
export const HEALTH_CONSENT = "health_data_processing";
/** Consent to process the entered data for the request, before "send to the manager". */
export const INQUIRY_CONSENT = "lead_inquiry_processing";

export type LeadRequestPersonalData = {
  first_name: string;
  middle_name: string | null;
  last_name: string;
  date_of_birth: string | null;
  legal_sex: string | null;
  citizenships: string[];
  street_address: string | null;
  zip_code: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  primary_language: string | null;
  /** The insurance block of wizard step 1 (owner request 2026-10-05). */
  has_insurance: boolean | null;
  insurance_type: string | null;
  insurance_provider: string | null;
  insurance_number: string | null;
  insurance_covers_germany: string | null;
};

export type LeadRequestConsent = {
  type: string;
  version: string;
  /** The exact text per language (de, ru, uk, en); what is shown is what is stored. */
  texts: Record<string, string>;
  given_at: string | null;
};

export type LeadRequestDocument = {
  id: string;
  file_name: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  uploaded_at: string;
  uploaded_by_me: boolean;
  reviewed: boolean;
  can_delete: boolean;
};

/** One request (lead) the login fills in: its own or, as a parent, a child's. */
export type LeadRequest = {
  lead_id: string;
  access_kind: "self" | "guardian";
  created_at: string;
  personal_data: LeadRequestPersonalData;
  progress: { filled: number; total: number; missing_for_submit: string[] };
  minor: boolean;
  documents: LeadRequestDocument[];
  max_documents: number;
  consents: Record<string, LeadRequestConsent>;
  submitted_at: string | null;
  /** Data or documents changed after sending; absent on an older server. */
  changed_since_submit?: boolean;
  retention_deadline_at: string | null;
};

export type PersonalDataPatch = Partial<Record<keyof LeadRequestPersonalData, string | string[]>>;

const base = (leadId: string) => `/me/lead-requests/${encodeURIComponent(leadId)}`;

export async function fetchMyLeadRequests(): Promise<LeadRequest[]> {
  const result = await apiFetch<{ requests: LeadRequest[] }>("/me/lead-requests", { forceFresh: true });
  return result.requests ?? [];
}

export function saveLeadPersonalData(leadId: string, patch: PersonalDataPatch): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/personal-data`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
}

export function giveLeadConsent(
  leadId: string,
  purpose: string,
  version: string,
  language: string,
): Promise<{ purpose: string; given_at: string; version: string }> {
  return apiFetch(`${base(leadId)}/consent`, {
    method: "POST",
    body: JSON.stringify({ purpose, version, language }),
  });
}

export function revokeLeadConsent(leadId: string, purpose: string): Promise<{ revoked: boolean }> {
  return apiFetch(`${base(leadId)}/consent/revoke`, {
    method: "POST",
    body: JSON.stringify({ purpose }),
  });
}

export function uploadLeadDocument(leadId: string, file: File): Promise<LeadRequest> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<LeadRequest>(`${base(leadId)}/documents`, { method: "POST", body: form });
}

export function withdrawLeadDocument(leadId: string, documentId: string): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
}

export function submitLeadRequest(leadId: string): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/submit`, { method: "POST" });
}
