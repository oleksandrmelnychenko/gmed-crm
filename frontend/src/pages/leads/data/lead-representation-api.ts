import { apiFetch } from "@/lib/api";

import {
  normalizeLeadRepresentation,
  type LeadCustody,
  type LeadRepresentation,
} from "./lead-portal-intake-api";

const base = (leadId: string) => `/leads/${encodeURIComponent(leadId)}`;

/** Both staff endpoints answer `{ "representation": … }`; null when the answer is not one. */
function representationOf(value: unknown): LeadRepresentation | null {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
  return normalizeLeadRepresentation(record?.representation);
}

/**
 * Staff state who represents a minor (both parents, one parent alone, a
 * guardian). Nobody is removed by it; the server refuses it for an adult.
 */
export async function setLeadCustody(leadId: string, custody: LeadCustody): Promise<LeadRepresentation | null> {
  return representationOf(
    await apiFetch<unknown>(`${base(leadId)}/representation`, {
      method: "POST",
      body: JSON.stringify({ custody }),
    }),
  );
}

/**
 * Removes the GwG data of one representative (what was entered in the cabinet
 * and the links to the uploads). The trusted contact and the documents stay;
 * the contact can then be removed in the wizard as usual.
 */
export async function removeLeadRepresentativeData(
  leadId: string,
  representativeId: string,
): Promise<LeadRepresentation | null> {
  return representationOf(
    await apiFetch<unknown>(`${base(leadId)}/representatives/${encodeURIComponent(representativeId)}`, {
      method: "DELETE",
    }),
  );
}
