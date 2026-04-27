import { apiFetch } from "@/lib/api";
import type {
  PortalAppointmentItem,
  PortalFeedbackItem,
  PortalFeedbackSummary,
} from "@/pages/patients/model/portal-shared";

import type { PatientAppointmentOption, PatientOption } from "../model/types";

type JsonPayload = Record<string, unknown>;

const FEEDBACK_PORTAL_CACHE_TTL_MS = 15_000;
const FEEDBACK_LOOKUPS_CACHE_TTL_MS = 60_000;

function postJson(path: string, payload: JsonPayload) {
  return apiFetch(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchPatientFeedbackWorkspace() {
  const [feedback, appointments] = await Promise.all([
    apiFetch<PortalFeedbackItem[]>("/me/feedback", {
      cacheTtlMs: FEEDBACK_PORTAL_CACHE_TTL_MS,
    }).catch(() => []),
    apiFetch<PortalAppointmentItem[]>("/me/appointments", {
      cacheTtlMs: FEEDBACK_PORTAL_CACHE_TTL_MS,
    }).catch(() => []),
  ]);
  return { feedback, appointments };
}

export function submitPatientFeedback(payload: JsonPayload) {
  return postJson("/me/feedback", payload);
}

export async function fetchStaffFeedbackWorkspace(queryString: string) {
  const [feedback, summary] = await Promise.all([
    apiFetch<PortalFeedbackItem[]>(`/feedback${queryString}`).catch(() => []),
    apiFetch<PortalFeedbackSummary>(`/feedback/summary${queryString}`).catch(
      () => null,
    ),
  ]);
  return { feedback, summary };
}

export function fetchFeedbackPatients() {
  return apiFetch<PatientOption[]>("/patients?active_only=true", {
    cacheTtlMs: FEEDBACK_LOOKUPS_CACHE_TTL_MS,
  });
}

export function fetchFeedbackPatientAppointments(patientId: string) {
  return apiFetch<PatientAppointmentOption[]>(
    `/patients/${patientId}/appointments`,
    { cacheTtlMs: FEEDBACK_LOOKUPS_CACHE_TTL_MS },
  );
}

export function captureStaffFeedback(payload: JsonPayload) {
  return postJson("/feedback", payload);
}

export function reviewFeedback(feedbackId: string, payload: JsonPayload) {
  return postJson(`/feedback/${feedbackId}/review`, payload);
}
