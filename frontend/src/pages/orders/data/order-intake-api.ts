import { apiFetch } from "@/lib/api";
import type { IntakeAction, IntakeDraft, IntakeFacts, IntakeWorkspace } from "../model/order-intake";

export function fetchIntakeFacts(patientId: string) {
  return apiFetch<{ facts: IntakeFacts }>(`/patients/${patientId}/order-intakes`, { forceFresh: true });
}
export function createOrderIntake(patientId: string, requestId: string, baseline: IntakeFacts) {
  return apiFetch<IntakeWorkspace>(`/patients/${patientId}/order-intakes`, {
    method: "POST", body: JSON.stringify({ request_id: requestId, baseline_facts: baseline }),
  });
}
export function fetchOrderIntake(orderId: string) {
  return apiFetch<IntakeWorkspace>(`/orders/${orderId}/intake`, { forceFresh: true });
}
export function saveOrderIntake(orderId: string, revision: number, data: IntakeDraft, action: IntakeAction) {
  return apiFetch<IntakeWorkspace>(`/orders/${orderId}/intake`, {
    method: "POST", body: JSON.stringify({ revision, data, action }), timeoutMs: 60_000,
  });
}
