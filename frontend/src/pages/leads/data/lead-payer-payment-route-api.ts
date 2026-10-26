import { apiFetch } from "@/lib/api";

import { normalizePayerDeclarationResponse } from "../model/lead-payer";

/**
 * `POST /leads/{id}/payer-declaration/payment-route` (leads.edit): staff
 * enter or correct a third-party payer's payment route — only the changed
 * keys of section 8 (`paymentRoutePatch`). Answers the payer declaration as
 * `GET /leads/{id}/payer-declaration` does.
 */
export async function saveLeadPayerPaymentRoute(leadId: string, patch: Record<string, string | boolean | null>) {
  return normalizePayerDeclarationResponse(
    await apiFetch<unknown>(`/leads/${leadId}/payer-declaration/payment-route`, {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  );
}
