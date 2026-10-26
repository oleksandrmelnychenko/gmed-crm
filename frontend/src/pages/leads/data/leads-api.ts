import { apiFetch } from "@/lib/api";
import {
  convertLead as apiConvertLead,
  downloadLeadAttachment as apiDownloadLeadAttachment,
} from "@/lib/api/leads";
import type {
  CreateLeadBody,
  LeadDetail,
  LeadPrefilledFromSource,
  LeadsStats,
  LoginEmailDeliveryStatus,
} from "@/lib/api/types";

import type { LeadListItem } from "../model/types";

type JsonPayload = Record<string, unknown>;

const LEAD_STATS_CACHE_TTL_MS = 30_000;

function postJson<T>(path: string, payload: JsonPayload) {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchLeads(path: string) {
  return apiFetch<LeadListItem[]>(path);
}

export async function fetchLeadStats() {
  const stats = await apiFetch<LeadsStats>("/stats/leads", {
    cacheTtlMs: LEAD_STATS_CACHE_TTL_MS,
  }).catch(() => null);
  return { stats };
}

export function fetchLeadDetail(leadId: string) {
  return apiFetch<LeadDetail>(`/leads/${leadId}`);
}

export type LeadReferrerPatientOption = {
  id: string;
  patient_id: string;
  title: string | null;
  first_name: string;
  last_name: string;
  /** Absent for roles without `patients.view` (Sales): name and number only. */
  birth_date?: string;
  email?: string | null;
  phone?: string | null;
};

export function fetchLeadReferrerPatients(search = "") {
  const query = search.trim();
  const suffix = query ? `?search=${encodeURIComponent(query)}` : "";
  return apiFetch<LeadReferrerPatientOption[]>(`/leads/referrer-patients${suffix}`, {
    cacheTtlMs: 60_000,
  });
}

export type LeadGuardianCandidate = {
  id: string;
  source: "patient" | "lead";
  patient_record_id: string | null;
  display_id: string | null;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  /**
   * True for a patient row a role without `patients.view` (Sales) sees: only
   * the name and patient number come, the contact data stays hidden.
   */
  contact_hidden?: boolean;
  /**
   * The person-level data the system holds (DEV 2026-10-26: picking a known
   * father left the GwG block empty): address parts, citizenships and birth
   * data; for a patient also the card's identity document. Countries are ISO
   * 3166-1 alpha-2 codes; null / empty when unknown or hidden. Absent on an
   * older server.
   */
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
  citizenships?: string[];
  birth_place?: string | null;
  birth_country?: string | null;
  id_document_type?: string | null;
  id_document_number?: string | null;
  id_issuing_authority?: string | null;
  id_issuing_country?: string | null;
  id_issued_on?: string | null;
  id_valid_until?: string | null;
};

export function fetchLeadGuardianCandidates(search = "", excludeLeadId?: string | null) {
  const query = new URLSearchParams({ search: search.trim() });
  if (excludeLeadId) query.set("exclude_lead_id", excludeLeadId);
  return apiFetch<LeadGuardianCandidate[]>(`/leads/guardian-candidates?${query}`);
}

/** Patient login issued for a lead; the password only for CEO / patient managers. */
export type LeadPortalAccountIssued = {
  user_id: string;
  email: string;
  created: boolean;
  reused?: boolean;
  password_changed?: boolean;
  one_time_password: string | null;
};

export type CreateLeadResponse = {
  id: string;
  idempotent_replay?: boolean;
  portal_account?: LeadPortalAccountIssued;
  /** Present when the body named a `source_person`. */
  prefilled_from_source?: LeadPrefilledFromSource | null;
};

/** Owner of an e-mail address that a lead may not take (409 `portal_email_taken`). */
export type PortalEmailOwner = {
  user_id: string | null;
  name: string | null;
  role: string | null;
  is_active: boolean | null;
  lead_id: string | null;
  lead_name: string | null;
  patient_id: string | null;
  patient_code: string | null;
  patient_name: string | null;
};

/**
 * Whose login an address typed in the contact editor already is (DEV QA
 * V-A6): `kind` only, without number or name, for a staff login or a patient
 * the caller may not read.
 */
export type ContactEmailLoginOwner = {
  kind: "patient" | "lead" | "staff";
  patient_id: string | null;
  patient_number: string | null;
  lead_id: string | null;
  display_name: string | null;
};

/**
 * `POST /leads/{id}/contact-email-check`: a POST so the address never sits in
 * a URL. `contactId` is the trusted contact the address is typed for (its own
 * guardian login is not reported), `relatedPatientId` the patient record the
 * editor links it to.
 */
export function checkLeadContactEmail(
  leadId: string,
  email: string,
  contactId?: string | null,
  relatedPatientId?: string | null,
) {
  return postJson<{ login_owner: ContactEmailLoginOwner | null }>(`/leads/${leadId}/contact-email-check`, {
    email,
    contact_id: contactId || null,
    related_patient_id: relatedPatientId || null,
  }).then((body) => body.login_owner ?? null);
}

export type LeadPortalAccountState = {
  account: {
    user_id: string;
    email: string | null;
    is_active: boolean;
    password_change_pending: boolean;
    created_at: string | null;
    last_login_at: string | null;
  } | null;
  can_issue_password: boolean;
};

export function fetchLeadPortalAccount(leadId: string) {
  return apiFetch<LeadPortalAccountState>(`/leads/${leadId}/portal-account`);
}

/** Creates the login of a lead without one, or issues a new one-time password. */
export function issueLeadPortalAccess(leadId: string) {
  return postJson<LeadPortalAccountIssued>(`/leads/${leadId}/portal-account`, {});
}

export type LeadLoginEmailLanguage = "de" | "en" | "ru" | "uk";

export type LeadLoginEmailRecord = {
  user_id: string;
  recipient: string;
  language: LeadLoginEmailLanguage;
  status: "sent" | "failed";
  error_code: string | null;
  sent_at: string;
  sent_by_name: string | null;
  /** What Mittaro reported later; null until the first check. */
  delivery_status?: LoginEmailDeliveryStatus | null;
  delivery_updated_at?: string | null;
};

/** Whether sign-in data can be e-mailed (Mittaro), and what was sent so far. */
export type LeadLoginEmailInfo = {
  available: boolean;
  reason_code: string;
  can_send: boolean;
  /** The language of the lead or patient, unless the dialog picks another. */
  default_language?: LeadLoginEmailLanguage | null;
  lead_language: LeadLoginEmailLanguage | null;
  sent: LeadLoginEmailRecord[];
};

/** Whose login a sign-in e-mail is about: a lead's (or a parent's) or a patient's. */
export type PortalLoginTarget = { kind: "lead" | "patient"; id: string };

function loginEmailPath(target: PortalLoginTarget) {
  return `/${target.kind === "patient" ? "patients" : "leads"}/${target.id}/portal-login-email`;
}

/**
 * `userId`: the login the dialog shows; for a parent's login the server
 * answers with the parent's own language as `default_language`.
 */
export function fetchPortalLoginEmails(target: PortalLoginTarget, userId?: string) {
  const query = target.kind === "lead" && userId ? `?user_id=${encodeURIComponent(userId)}` : "";
  return apiFetch<LeadLoginEmailInfo>(`${loginEmailPath(target)}${query}`);
}

export function sendPortalLoginEmail(
  target: PortalLoginTarget,
  body: { user_id: string; password: string; language: LeadLoginEmailLanguage },
) {
  return postJson<LeadLoginEmailSent>(loginEmailPath(target), body);
}

export type LeadLoginEmailSent = {
  sent_to: string;
  sent_at: string;
  language: LeadLoginEmailLanguage;
  message_id: string;
  /** The same message had been sent already; nothing new went out. */
  replayed: boolean;
};

export function fetchLeadLoginEmails(leadId: string) {
  return apiFetch<LeadLoginEmailInfo>(`/leads/${leadId}/portal-login-email`);
}

/**
 * E-mails the sign-in data of the lead's login or of a parent's login. The
 * server sends the password only while it is still the login's current one.
 */
export function sendLeadLoginEmail(
  leadId: string,
  body: { user_id: string; password: string; language: LeadLoginEmailLanguage },
) {
  return postJson<LeadLoginEmailSent>(`/leads/${leadId}/portal-login-email`, body);
}

export function createLead(payload: CreateLeadBody) {
  return postJson<CreateLeadResponse>("/leads", payload as unknown as JsonPayload);
}

/**
 * Changes the qualification status. With `not_qualified` the reason (a code
 * of `LEAD_FAILURE_REASONS` or a free text) is stored as the lead's failure
 * reason and comes back as `failed_outcome.reason`.
 */
export function updateLeadStatus(leadId: string, status: string, reason?: string) {
  return postJson<void>(`/leads/${leadId}/qualify`, reason ? { status, reason } : { status });
}

export function updateLeadGate(leadId: string, payload: JsonPayload) {
  return postJson<void>(`/leads/${leadId}/update`, payload);
}

export function promoteLeadToConsole(leadId: string) {
  return postJson<void>(`/leads/${leadId}/promote-console`, {});
}

/** A questionnaire file the import refused (`import_refusal_code` on the attachment). */
export type LeadAttachmentImportRefusal = { id: string; file_name: string; code: string | null };

export function importLeadAttachments(leadId: string) {
  return postJson<{ imported: number; refused?: LeadAttachmentImportRefusal[] }>(`/leads/${leadId}/import-attachments`, {});
}

export function resolveFailedLead(leadId: string, payload: JsonPayload) {
  return postJson<void>(`/leads/${leadId}/failed-flow`, payload);
}

export function convertLead(leadId: string) {
  return apiConvertLead(leadId);
}

export type WizardConvertResponse = {
  patient_id: string;
  patient_pid: string;
};

export type ProspectDuplicateCandidate = {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  lifecycle_status: string;
  email: string | null;
  residence_country: string | null;
};

export type ProspectResponse = {
  patient_id?: string;
  patient_pid?: string;
  case_id?: string;
  case_code?: string;
  lifecycle_status?: string;
  already_exists?: boolean;
  attached?: boolean;
  duplicate_candidates?: ProspectDuplicateCandidate[];
};

/** Create (or resolve) the prospect patient + funnel case for a patient_first lead. */
export function createLeadProspect(
  leadId: string,
  payload: {
    attach_patient_id?: string;
    force_create?: boolean;
    hauptanfragegrund?: string;
    zuweiser?: string;
  } = {},
) {
  return postJson<ProspectResponse>(`/leads/${leadId}/prospect`, payload);
}

/** Save any subset of the wizard's editable lead fields (#12). */
export function updateLeadWizard(leadId: string, payload: JsonPayload) {
  return postJson<void>(`/leads/${leadId}/update`, payload);
}

/** Convert a fully ready lead; the backend returns the exact blocking checks otherwise. */
export function wizardConvertLead(leadId: string, confirmed: boolean) {
  return postJson<WizardConvertResponse>(`/leads/${leadId}/wizard-convert`, {
    confirmed,
  });
}

export function downloadLeadAttachment(leadId: string, fileId: string) {
  return apiDownloadLeadAttachment(leadId, fileId);
}
