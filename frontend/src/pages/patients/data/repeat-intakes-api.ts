import { apiFetch } from "@/lib/api";

export type RepeatIntakeSummary = {
  id: string;
  created_at: string;
  updated_at?: string;
  concern?: string | null;
};

export function fetchRepeatIntakes(patientId: string) {
  return apiFetch<RepeatIntakeSummary[]>(`/patients/${patientId}/repeat-intakes`, {
    forceFresh: true,
  });
}

/**
 * Draft deletion is intentionally implemented as an audited archive. The
 * linked draft order is cancelled by the repeat-intake integrity trigger, so
 * no clinical or commercial history is physically erased.
 */
export function discardRepeatIntake(leadId: string) {
  return apiFetch<void>(`/leads/${leadId}/failed-flow`, {
    method: "POST",
    body: JSON.stringify({
      resolution: "archive",
      reason: "draft_discarded",
    }),
  });
}

export function discardOrderDraft(orderId: string, repeatLeadId?: string | null) {
  if (repeatLeadId) return discardRepeatIntake(repeatLeadId);

  return apiFetch<void>(`/orders/${orderId}/status`, {
    method: "POST",
    body: JSON.stringify({
      status: "cancelled",
      note: "draft_discarded",
    }),
  });
}
