import { apiFetch } from "@/lib/api";
import {
  convertLead as apiConvertLead,
  downloadLeadAttachment as apiDownloadLeadAttachment,
} from "@/lib/api/leads";
import type {
  CreateLeadBody,
  LeadDetail,
  LeadsStats,
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
  birth_date: string;
  email: string | null;
  phone: string | null;
};

export function fetchLeadReferrerPatients(search = "") {
  const query = search.trim();
  const suffix = query ? `?search=${encodeURIComponent(query)}` : "";
  return apiFetch<LeadReferrerPatientOption[]>(`/leads/referrer-patients${suffix}`, {
    cacheTtlMs: 60_000,
  });
}

/** Patient login issued for a lead; the password only for CEO / patient managers. */
export type LeadPortalAccountIssued = {
  user_id: string;
  email: string;
  created: boolean;
  one_time_password: string | null;
};

export type CreateLeadResponse = {
  id: string;
  idempotent_replay?: boolean;
  portal_account?: LeadPortalAccountIssued;
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
};

/** Whether sign-in data can be e-mailed (Mittaro), and what was sent so far. */
export type LeadLoginEmailInfo = {
  available: boolean;
  reason_code: string;
  can_send: boolean;
  lead_language: LeadLoginEmailLanguage | null;
  sent: LeadLoginEmailRecord[];
};

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

export function updateLeadStatus(leadId: string, status: string) {
  return postJson<void>(`/leads/${leadId}/qualify`, { status });
}

export function updateLeadGate(leadId: string, payload: JsonPayload) {
  return postJson<void>(`/leads/${leadId}/update`, payload);
}

export function promoteLeadToConsole(leadId: string) {
  return postJson<void>(`/leads/${leadId}/promote-console`, {});
}

export function importLeadAttachments(leadId: string) {
  return postJson<{ imported: number }>(`/leads/${leadId}/import-attachments`, {});
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
