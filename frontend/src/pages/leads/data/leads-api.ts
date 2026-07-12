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

export type CreateLeadResponse = {
  id: string;
};

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

/** Save any subset of the wizard's editable lead fields (#12). */
export function updateLeadWizard(leadId: string, payload: JsonPayload) {
  return postJson<void>(`/leads/${leadId}/update`, payload);
}

/** Convert a fully ready lead; the backend returns the exact blocking checks otherwise. */
export function wizardConvertLead(leadId: string) {
  return postJson<WizardConvertResponse>(`/leads/${leadId}/wizard-convert`, {});
}

export function downloadLeadAttachment(leadId: string, fileId: string) {
  return apiDownloadLeadAttachment(leadId, fileId);
}
