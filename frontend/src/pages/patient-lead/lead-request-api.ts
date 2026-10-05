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

/** What a third-party payer is: a natural person, or a company, organisation or insurer. */
export type PayerType = "person" | "company" | "organisation" | "insurance";

/**
 * Who pays, as stated in the cabinet (owner request 2026-10-05). A third
 * party is named with identity and citizenships; staff complete the rest.
 */
export type LeadRequestPayer = {
  payer_kind: "self" | "third_party";
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  citizenships: string[];
  /** Free text; with `relationship_kind` only for the kind `other`. */
  relationship: string | null;
  email: string | null;
  phone: string | null;
  /**
   * Own economic interest (GwG): `null` until answered, absent on an older
   * server. On "no" the person in whose interest the patient acts is named.
   */
  acts_on_own_account?: boolean | null;
  beneficial_owner?: string | null;
  /**
   * The payer block of the owner spec, sections 5 and 6: what the third party
   * is (`null` for "I pay myself"), the name of a company, organisation or
   * insurer, the relationship from the list, and when the lead agreed that
   * GMED contacts the payer. All four are absent on an older server.
   */
  payer_type?: PayerType | null;
  organisation_name?: string | null;
  /** `spouse`, `parent`, `child`, `relative`, `employer`, `friend`, `business_partner` or `other`. */
  relationship_kind?: string | null;
  contact_consent_at?: string | null;
};

/** What the cabinet sends: the whole answer, empty values left out. */
export type LeadRequestPayerInput = {
  payer_kind: "self" | "third_party";
  first_name?: string;
  last_name?: string;
  date_of_birth?: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  citizenships?: string[];
  relationship?: string;
  email?: string;
  phone?: string;
  /** Left out until answered: the server then keeps the stored answer. */
  acts_on_own_account?: boolean;
  /** Sent with the answer "no" only. */
  beneficial_owner?: string;
  /** Sent with a third party to a server that knows the payer type. */
  payer_type?: PayerType;
  organisation_name?: string;
  relationship_kind?: string;
  /** `true` records the consent (the first time stays), `false` removes it. */
  contact_consent?: boolean;
};

/**
 * A parent's own data for the answer "I pay (as a parent)", taken from the
 * lead's trusted contact the login is linked to. A single-word name is the
 * last name: the first name is then empty.
 */
export type PayerSelfTemplate = {
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  email: string | null;
  phone: string | null;
};

/**
 * The lead's own statements for the GwG identification sheet (owner spec
 * "Patientenformular", 2026-10-05). Everything is optional until the request
 * is sent.
 */
export type LeadRequestIdentification = {
  /** `mr`, `ms` or `none`. */
  salutation: string | null;
  former_names: string | null;
  birth_place: string | null;
  birth_country: string | null;
  /** Only when it differs from the country of residence. */
  habitual_residence_country: string | null;
  /** Subset of `email`, `phone`, `messenger`. */
  contact_channels: string[];
  /** `passport`, `id_card` or `residence_permit`. */
  id_document_type: string | null;
  id_document_number: string | null;
  id_issuing_authority: string | null;
  id_issuing_country: string | null;
  id_issued_on: string | null;
  id_valid_until: string | null;
  pep_self: boolean | null;
  pep_self_details: string | null;
  pep_related: boolean | null;
  pep_related_details: string | null;
  high_risk_country: boolean | null;
  high_risk_country_code: string | null;
  sanctions_links: boolean | null;
  sanctions_links_details: string | null;
  /** Why another person pays; asked with a third-party payer only. */
  payment_background: string | null;
  /** Set by the server when the request is sent with the confirmation. */
  declared_correct_at: string | null;
};

/** Only the changed keys: `""` clears a text, date or choice, `null` an answer. */
export type IdentificationPatch = Partial<
  Record<Exclude<keyof LeadRequestIdentification, "declared_correct_at">, string | string[] | boolean | null>
>;

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
  /** `null` until the question is answered; absent on an older server. */
  payer?: LeadRequestPayer | null;
  /**
   * For a parent's login linked to a trusted contact of the lead; otherwise
   * `null`. Absent on a server that does not know the payer type yet.
   */
  payer_self_template?: PayerSelfTemplate | null;
  /** The statements for the identification; absent on an older server. */
  identification?: LeadRequestIdentification;
  /** Photos or scans of the identity document; never among `documents` (medical). */
  identity_documents?: LeadRequestDocument[];
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

export function saveLeadPayer(leadId: string, payer: LeadRequestPayerInput): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/payer`, {
    method: "POST",
    body: JSON.stringify(payer),
  });
}

export function saveLeadIdentification(leadId: string, patch: IdentificationPatch): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/identification`, {
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

/** A photo or scan of the identity document; the server needs the request consent first. */
export function uploadLeadIdentityDocument(leadId: string, file: File): Promise<LeadRequest> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<LeadRequest>(`${base(leadId)}/identity-document`, { method: "POST", body: form });
}

/** Withdraws an own upload: a medical document or a copy of the identity document. */
export function withdrawLeadDocument(leadId: string, documentId: string): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });
}

/**
 * Sends the request. `declaredCorrect` is the confirmation that the statements
 * are complete and true; a server that knows the identification requires it.
 */
export function submitLeadRequest(leadId: string, declaredCorrect: boolean): Promise<LeadRequest> {
  return apiFetch<LeadRequest>(`${base(leadId)}/submit`, {
    method: "POST",
    ...(declaredCorrect ? { body: JSON.stringify({ declared_correct: true }) } : {}),
  });
}
