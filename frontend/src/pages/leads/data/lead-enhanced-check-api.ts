import { apiFetch } from "@/lib/api";

import { normalizeLeadEnhancedCheck } from "../model/enhanced-check";

/** `GET /leads/{id}/enhanced-check`: whether the owner's rule requires the enhanced check, and why. */
export async function fetchLeadEnhancedCheck(leadId: string) {
  return normalizeLeadEnhancedCheck(
    await apiFetch<unknown>(`/leads/${encodeURIComponent(leadId)}/enhanced-check`, { forceFresh: true }),
  );
}
