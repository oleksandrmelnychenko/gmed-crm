import { get, post } from "./client";
import { getAccessToken } from "@/lib/api";
import type {
  Lead,
  LeadDetail,
  CreateLeadBody,
  QualifyLeadBody,
  ConvertLeadResponse,
} from "./types";

export function fetchLeads(params?: {
  search?: string;
  status?: string;
  source?: string;
  country?: string;
  intake_source?: string;
  flow?: string;
  include_archived?: boolean;
}): Promise<Lead[]> {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.status) q.set("status", params.status);
  if (params?.source) q.set("source", params.source);
  if (params?.country) q.set("country", params.country);
  if (params?.intake_source) q.set("intake_source", params.intake_source);
  if (params?.flow) q.set("flow", params.flow);
  if (params?.include_archived)
    q.set("include_archived", String(params.include_archived));
  const qs = q.toString();
  return get<Lead[]>(`/leads${qs ? `?${qs}` : ""}`);
}

export function fetchLead(id: string): Promise<LeadDetail> {
  return get<LeadDetail>(`/leads/${id}`);
}

export function createLead(body: CreateLeadBody): Promise<{ id: string }> {
  return post<{ id: string }>("/leads", body);
}

export function qualifyLead(
  id: string,
  body: QualifyLeadBody,
): Promise<unknown> {
  return post(`/leads/${id}/qualify`, body);
}

export function convertLead(id: string): Promise<ConvertLeadResponse> {
  return post<ConvertLeadResponse>(`/leads/${id}/convert`, undefined);
}

export async function downloadLeadAttachment(
  leadId: string,
  attachmentId: string,
): Promise<Blob> {
  const token = getAccessToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(
    `/api/v1/leads/${leadId}/attachments/${attachmentId}`,
    { headers },
  );
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status}`);
  }
  return res.blob();
}
