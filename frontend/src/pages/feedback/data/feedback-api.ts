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

/**
 * Reviews and summary of the staff page. A failed request rejects: the page
 * shows an error with a retry instead of "0 reviews / no records", which a
 * manager would read as "there are no reviews" (QA E3-07).
 */
export async function fetchStaffFeedbackWorkspace(queryString: string) {
  const [feedback, summary] = await Promise.all([
    apiFetch<PortalFeedbackItem[]>(`/feedback${queryString}`),
    apiFetch<PortalFeedbackSummary>(`/feedback/summary${queryString}`),
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
