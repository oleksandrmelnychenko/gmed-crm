import { apiFetch } from "@/lib/api";

import {
  normalizePayerDeclarationResponse,
  type payerDeclarationPayload,
} from "../model/lead-payer";
import type { ParentBillingRoleBody } from "../model/parent-billing-role";

export async function fetchLeadPayerDeclaration(leadId: string) {
  return normalizePayerDeclarationResponse(
    await apiFetch<unknown>(`/leads/${leadId}/payer-declaration`, { forceFresh: true }),
  );
}

export async function saveLeadPayerDeclaration(
  leadId: string,
  payload: ReturnType<typeof payerDeclarationPayload>,
) {
  return normalizePayerDeclarationResponse(
    await apiFetch<unknown>(`/leads/${leadId}/payer-declaration`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  );
}

/**
 * `PUT /leads/{id}/representatives/{representative_id}/billing-role`
 * (leads.edit, owner 2026-11-02): whether a minor's parent receives the
 * invoice and/or pays; the server writes the lead's recipient and payer and
 * answers with the roles as stored.
 */
export async function saveLeadParentBillingRole(
  leadId: string,
  representativeId: string,
  body: ParentBillingRoleBody,
): Promise<ParentBillingRoleBody> {
  return apiFetch<ParentBillingRoleBody>(`/leads/${leadId}/representatives/${representativeId}/billing-role`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}
