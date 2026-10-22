import { apiFetch } from "@/lib/api";

import { normalizeRiskCountryLists } from "../model/enhanced-check";

/** `GET /compliance/risk-countries`: list 1 and list 2 of the risk configuration. */
export async function fetchRiskCountryLists() {
  return normalizeRiskCountryLists(await apiFetch<unknown>("/compliance/risk-countries", { forceFresh: true }));
}
