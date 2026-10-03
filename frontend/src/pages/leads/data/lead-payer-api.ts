import { apiFetch } from "@/lib/api";

import {
  normalizePayerDeclarationResponse,
  type payerDeclarationPayload,
} from "../model/lead-payer";

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
