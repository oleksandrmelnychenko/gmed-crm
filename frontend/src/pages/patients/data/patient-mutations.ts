import { apiFetch } from "@/lib/api";

export async function createPatient(payload: Record<string, unknown>) {
  return apiFetch<{ id: string }>("/patients", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updatePatient(patientId: string, payload: Record<string, unknown>) {
  return apiFetch(`/patients/${patientId}/update`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function togglePatientActivation(patientId: string, isActive: boolean) {
  return apiFetch(isActive ? `/patients/${patientId}/deactivate` : `/patients/${patientId}/activate`, {
    method: "POST",
  });
}

export async function assignPatient(patientId: string, userId: string) {
  return apiFetch(`/patients/${patientId}/assign`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}
