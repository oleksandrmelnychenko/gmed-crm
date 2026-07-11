import type { CaseRosterItem } from "@/components/cases-roster-section";
import { apiFetch } from "@/lib/api";

import type {
  CaseDetail,
  CaseTextSnippet,
  DoctorOption,
  PatientOption,
} from "../model/types";

type JsonPayload = Record<string, unknown>;

const CASE_LOOKUPS_CACHE_TTL_MS = 60_000;
const CASE_STATIC_META_CACHE_TTL_MS = 300_000;

function postJson<T>(path: string, payload: JsonPayload = {}) {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchCaseLookups() {
  const [patients, doctors] = await Promise.all([
    apiFetch<PatientOption[]>("/patients", {
      cacheTtlMs: CASE_LOOKUPS_CACHE_TTL_MS,
    }).catch(() => []),
    apiFetch<DoctorOption[]>("/cases/meta/doctors", {
      cacheTtlMs: CASE_STATIC_META_CACHE_TTL_MS,
    }).catch(() => []),
  ]);
  return { patients, doctors };
}

export function fetchCaseTextSnippets() {
  return apiFetch<CaseTextSnippet[]>("/cases/text-snippets", {
    cacheTtlMs: CASE_STATIC_META_CACHE_TTL_MS,
  });
}

export function fetchCases(path: string) {
  return apiFetch<CaseRosterItem[]>(path);
}

export function fetchCaseDetail(caseId: string) {
  return apiFetch<CaseDetail>(`/cases/${caseId}`);
}

export function createCase(payload: JsonPayload) {
  return postJson<{ id: string }>("/cases", payload);
}

export function saveCaseTextSnippet(snippetId: string, payload: JsonPayload) {
  const path = snippetId
    ? `/cases/text-snippets/${snippetId}/update`
    : "/cases/text-snippets";
  return postJson<void>(path, payload);
}

export function saveCaseOverview(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/anamnesis`, payload);
}

export function completeCaseIntake(
  caseId: string,
  completed = true,
  fields: JsonPayload = {},
) {
  return postJson<{ ok: boolean; intake_completed_at: string | null }>(
    `/cases/${caseId}/intake-completion`,
    { ...fields, completed },
  );
}

export function saveCaseVorerkrankungen(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/vorerkrankungen`, payload);
}

export function saveCaseAllergien(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/allergien`, payload);
}

export function saveCaseOperationen(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/operationen`, payload);
}

export function saveCaseMedikamente(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/medikamente`, payload);
}

export function confirmMedicationExpiry(caseId: string, medicationId: string) {
  return apiFetch(`/cases/${caseId}/medikamente/${medicationId}/expiry-confirm`, {
    method: "POST",
  });
}

export function saveCasePain(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/pain`, payload);
}

export function saveCaseSymptome(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/symptome`, payload);
}

export function saveCaseCardiology(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/cardiology`, payload);
}

export function saveCaseGastroenterology(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/gastroenterology`, payload);
}

export function saveCaseOrthopedics(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/orthopedics`, payload);
}

export function saveCaseNeurology(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/neurology`, payload);
}

export function saveCasePulmonology(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/pulmonology`, payload);
}

export function saveCaseUrology(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/urology`, payload);
}

export function saveCaseVegetative(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/vegetative`, payload);
}

export function saveCaseImpfstatus(caseId: string, payload: JsonPayload) {
  return postJson(`/cases/${caseId}/impfstatus`, payload);
}
