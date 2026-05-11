import { post } from "./client";
import { apiFetchFile } from "@/lib/api";
import type { ConvertLeadResponse } from "./types";

export function convertLead(id: string): Promise<ConvertLeadResponse> {
  return post<ConvertLeadResponse>(`/leads/${id}/convert`, undefined);
}

export async function downloadLeadAttachment(
  leadId: string,
  attachmentId: string,
): Promise<Blob> {
  const { blob } = await apiFetchFile(`/leads/${leadId}/attachments/${attachmentId}`);
  return blob;
}
