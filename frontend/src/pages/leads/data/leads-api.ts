import { apiFetch } from "@/lib/api";
import {
  convertLead as apiConvertLead,
  downloadLeadAttachment as apiDownloadLeadAttachment,
} from "@/lib/api/leads";
import type {
  CreateLeadBody,
  LeadDetail,
  LeadsStats,
  MonthlyEntry,
  StatusCount,
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
  const [stats, monthly, byStatus] = await Promise.all([
    apiFetch<LeadsStats>("/stats/leads", {
      cacheTtlMs: LEAD_STATS_CACHE_TTL_MS,
    }).catch(() => null),
    apiFetch<MonthlyEntry[]>("/stats/leads/monthly", {
      cacheTtlMs: LEAD_STATS_CACHE_TTL_MS,
    }).catch(() => []),
    apiFetch<StatusCount[]>("/stats/leads/by-status", {
      cacheTtlMs: LEAD_STATS_CACHE_TTL_MS,
    }).catch(() => []),
  ]);
  return { stats, monthly, byStatus };
}

export function fetchLeadDetail(leadId: string) {
  return apiFetch<LeadDetail>(`/leads/${leadId}`);
}

export function createLead(payload: CreateLeadBody) {
  return postJson<void>("/leads", payload as unknown as JsonPayload);
}

export function updateLeadStatus(leadId: string, status: string) {
  return postJson<void>(`/leads/${leadId}/qualify`, { status });
}

export function updateLeadGate(leadId: string, payload: JsonPayload) {
  return postJson<void>(`/leads/${leadId}/update`, payload);
}

export function resolveFailedLead(leadId: string, payload: JsonPayload) {
  return postJson<void>(`/leads/${leadId}/failed-flow`, payload);
}

export function convertLead(leadId: string) {
  return apiConvertLead(leadId);
}

export function downloadLeadAttachment(leadId: string, fileId: string) {
  return apiDownloadLeadAttachment(leadId, fileId);
}
