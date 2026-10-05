import { apiFetch } from "@/lib/api";

import {
  normalizeLeadIdentificationStatus,
  type IdentificationSubject,
} from "../model/lead-identification";

export async function fetchLeadIdentificationStatus(leadId: string) {
  return normalizeLeadIdentificationStatus(
    await apiFetch<unknown>(`/leads/${leadId}/identification-status`, { forceFresh: true }),
  );
}

/** Confirms (or takes back) the payment from the person's own account; answers with the new status. */
export async function setLeadOwnAccountPayment(
  leadId: string,
  subject: IdentificationSubject,
  confirmed: boolean,
) {
  return normalizeLeadIdentificationStatus(
    await apiFetch<unknown>(`/leads/${leadId}/identification-status/${subject}/own-account-payment`, {
      method: "POST",
      body: JSON.stringify({ confirmed }),
    }),
  );
}
