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

/**
 * The subject as a path segment: `contract_partner`, `payer` or
 * `representative:<id>`. The colon stays as it is (the server reads the
 * segment as one value); everything around it is encoded.
 */
export function identificationSubjectPath(subject: IdentificationSubject): string {
  return subject.split(":").map(encodeURIComponent).join(":");
}

/**
 * Confirms (or takes back) the payment from the person's own account; answers
 * with the new status. For a minor the person is a legal representative.
 */
export async function setLeadOwnAccountPayment(
  leadId: string,
  subject: IdentificationSubject,
  confirmed: boolean,
) {
  return normalizeLeadIdentificationStatus(
    await apiFetch<unknown>(
      `/leads/${leadId}/identification-status/${identificationSubjectPath(subject)}/own-account-payment`,
      {
        method: "POST",
        body: JSON.stringify({ confirmed }),
      },
    ),
  );
}
