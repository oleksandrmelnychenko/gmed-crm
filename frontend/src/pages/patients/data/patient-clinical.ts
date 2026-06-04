import { apiFetch } from "@/lib/api";

type JsonPayload = Record<string, unknown>;

function postJson<T = unknown>(path: string, payload?: JsonPayload) {
  const init: RequestInit = { method: "POST" };
  if (payload !== undefined) {
    init.body = JSON.stringify(payload);
  }
  return apiFetch<T>(path, init);
}

export type DiagnosisKind = "main" | "secondary";
export type DiagnosisStatus = "active" | "chronic" | "resolved";
export type DiagnosisLaterality = "left" | "right" | "bilateral";
export type MedicationCategory = "dauer" | "besondere" | "selbst";
export type ExaminationKind =
  | "sonography"
  | "lab"
  | "histology"
  | "ecg"
  | "microbiology"
  | "radiology"
  | "exam"
  | "other";
export type ExaminationStatus = "final" | "pending";

/** Provider + doctor attribution shared by every clinical entry. */
export type ClinicalAttribution = {
  provider_id: string | null;
  provider_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  doctor_title: string | null;
};

export type ClinicalDiagnosis = ClinicalAttribution & {
  id?: string;
  kind: DiagnosisKind;
  label: string;
  icd_code: string | null;
  grade: string | null;
  laterality: DiagnosisLaterality | null;
  status: DiagnosisStatus;
  diagnosed_on: string | null;
  note: string | null;
};

export type ClinicalMedication = ClinicalAttribution & {
  id?: string;
  category: MedicationCategory;
  wirkstoff: string | null;
  handelsname: string;
  staerke: string | null;
  form: string | null;
  dose_morgens: string | null;
  dose_mittags: string | null;
  dose_abends: string | null;
  dose_nachts: string | null;
  einheit: string | null;
  hinweis: string | null;
  grund: string | null;
};

export type ClinicalExamination = ClinicalAttribution & {
  id?: string;
  kind: ExaminationKind | null;
  title: string;
  performed_on: string | null;
  status: ExaminationStatus;
  result: string | null;
  note: string | null;
};

export type ClinicalNarrative = {
  anamnese_aktuelle: string | null;
  anamnese_vorgeschichte: string | null;
  anamnese_vegetative: string | null;
  anamnese_sozial: string | null;
  untersuchungsbefund: string | null;
  beurteilung: string | null;
  verlauf: string | null;
};

export type PatientClinicalProfile = {
  diagnoses: ClinicalDiagnosis[];
  medications: ClinicalMedication[];
  examinations: ClinicalExamination[];
  narrative: ClinicalNarrative | null;
};

export type PatientRecommendation = {
  id: string;
  title: string;
  description: string | null;
  recommendation_type: string | null;
  source_doctor_name: string | null;
  due_at: string | null;
  priority: string | null;
  status: string | null;
};

export function fetchPatientClinical(patientId: string) {
  return apiFetch<PatientClinicalProfile>(`/patients/${patientId}/clinical`);
}

export function fetchPatientRecommendations(patientId: string) {
  return apiFetch<PatientRecommendation[]>(`/patients/${patientId}/recommendations`);
}

export function savePatientDiagnoses(patientId: string, items: ClinicalDiagnosis[]) {
  return postJson(`/patients/${patientId}/diagnoses`, { items });
}

export function savePatientMedications(patientId: string, items: ClinicalMedication[]) {
  return postJson(`/patients/${patientId}/medications`, { items });
}

export function savePatientExaminations(patientId: string, items: ClinicalExamination[]) {
  return postJson(`/patients/${patientId}/examinations`, { items });
}

export function savePatientNarrative(patientId: string, narrative: ClinicalNarrative) {
  return postJson(`/patients/${patientId}/narrative`, { ...narrative });
}

export function blankNarrative(): ClinicalNarrative {
  return {
    anamnese_aktuelle: null,
    anamnese_vorgeschichte: null,
    anamnese_vegetative: null,
    anamnese_sozial: null,
    untersuchungsbefund: null,
    beurteilung: null,
    verlauf: null,
  };
}
