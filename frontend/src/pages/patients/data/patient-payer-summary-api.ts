import { apiFetch } from "@/lib/api";

/**
 * `GET /patients/{id}/payer-summary`: who pays for the patient, computed by
 * the server from the payer declaration of the most recently converted lead,
 * the contracting party and the invoice recipient rules. The answer is shaped
 * by `normalizePatientPayerSummary` (model), so an older server or a missing
 * key never breaks the card. Fresh by default: the card is the one reader and
 * must show a change made in the lead wizard or the relations tab at once.
 */
export function fetchPatientPayerSummary(
  patientId: string,
  { forceFresh = true }: { forceFresh?: boolean } = {},
) {
  return apiFetch<unknown>(`/patients/${patientId}/payer-summary`, { forceFresh });
}
