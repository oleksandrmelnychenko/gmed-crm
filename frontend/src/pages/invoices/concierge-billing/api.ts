import { apiFetch } from "@/lib/api";

import type { ConciergeBillingQueue } from "./model";

export function fetchConciergeBillingQueue(patientId?: string) {
  const query = patientId ? `?patient_id=${encodeURIComponent(patientId)}` : "";
  return apiFetch<ConciergeBillingQueue>(`/concierge-billing-queue${query}`, { forceFresh: true });
}
