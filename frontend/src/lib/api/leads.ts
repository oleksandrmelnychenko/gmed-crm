import { get, post, postNoBody } from "./client";
import type { Lead, CreateLeadBody, QualifyLeadBody } from "./types";

export function fetchLeads(params?: {
  search?: string;
  status?: string;
}): Promise<Lead[]> {
  const q = new URLSearchParams();
  if (params?.search) q.set("search", params.search);
  if (params?.status) q.set("status", params.status);
  const qs = q.toString();
  return get<Lead[]>(`/leads${qs ? `?${qs}` : ""}`);
}

export function createLead(body: CreateLeadBody): Promise<unknown> {
  return post("/leads", body);
}

export function qualifyLead(id: string, body: QualifyLeadBody): Promise<unknown> {
  return post(`/leads/${id}/qualify`, body);
}

export function convertLead(id: string): Promise<void> {
  return postNoBody(`/leads/${id}/convert`);
}
