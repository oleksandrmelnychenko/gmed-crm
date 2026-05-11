import { post } from "./client";
import { buildApiUrl, getAccessToken } from "@/lib/api";
import type { ConvertLeadResponse } from "./types";

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
    buildApiUrl(`/leads/${leadId}/attachments/${attachmentId}`),
    { headers },
  );
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status}`);
  }
  return res.blob();
}
