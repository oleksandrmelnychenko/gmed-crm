import { apiFetch } from "@/lib/api";

export type PatientSymptomItem = {
  id?: string;
  beschreibung: string;
  fachrichtung?: string | null;
};

export type PatientPainItem = {
  id?: string;
  lokalisierung: string;
  seit_wann?: string | null;
  ursache?: string | null;
  qualitaet?: string | null;
  kontinuitaet?: string | null;
  entwicklung?: string | null;
  nrs_aktuell?: number | null;
  nrs_anfang?: number | null;
  dauer_anfang?: string | null;
  dauer_aktuell?: string | null;
  ausstrahlung?: string | null;
  auftreten?: string | null;
};

type PatientClinicalItems<T> = { items: T[] };

export function fetchPatientSymptoms(patientId: string) {
  return apiFetch<PatientClinicalItems<PatientSymptomItem>>(
    `/patients/${patientId}/symptoms`,
  ).then((response) => response.items ?? []);
}

export function savePatientSymptoms(patientId: string, items: PatientSymptomItem[]) {
  return apiFetch<{ ok: boolean; count: number }>(`/patients/${patientId}/symptoms`, {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export function fetchPatientPain(patientId: string) {
  return apiFetch<PatientClinicalItems<PatientPainItem>>(`/patients/${patientId}/pain`).then(
    (response) => response.items ?? [],
  );
}

export function savePatientPain(patientId: string, items: PatientPainItem[]) {
  return apiFetch<{ ok: boolean; count: number }>(`/patients/${patientId}/pain`, {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}
