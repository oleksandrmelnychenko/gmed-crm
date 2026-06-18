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

/** Node kind in the diagnosis tree. */
export type DiagnosisNodeKind = "main" | "secondary" | "prozedur";
/** Diagnostic certainty; drives the label prefix (V.a. / Z.n.). */
export type DiagnosisCertainty = "verdacht" | "bestaetigt" | "zustand_nach";
/** Acuity / temporal course of the diagnosis. */
export type DiagnosisChronification = "akut" | "chronisch" | "rezidivierend";
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
  doctor_fachbereich: string | null;
};

export type ClinicalDiagnosis = ClinicalAttribution & {
  /** Server uuid; null/absent for a newly added node. */
  id?: string | null;
  /** Client id; for existing nodes cid === id, FE-generated for new ones. */
  cid?: string;
  /** Client parent reference used on SAVE. */
  parent_cid?: string | null;
  /** Server parent uuid, read-only, returned by GET. */
  parent_id?: string | null;
  kind: DiagnosisNodeKind;
  label: string;
  certainty: DiagnosisCertainty | null;
  chronifizierung: DiagnosisChronification | null;
  icd_code: string | null;
  ops_code: string | null;
  diagnosed_on: string | null;
  note: string | null;
  source_mode: "intern" | "extern";
  /** Extern attribution; external_country is an ISO 3166-1 alpha-2 code. */
  external_clinic: string | null;
  external_doctor: string | null;
  external_country: string | null;
  treating_doctor_id: string | null;
  treating_doctor_name: string | null;
  treating_doctor_title: string | null;
  treating_none: boolean;
  /** Legacy fields, kept optional for back-compat; the new UI ignores them. */
  status?: DiagnosisStatus;
  grade?: string | null;
  laterality?: DiagnosisLaterality | null;
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

export type ClinicalProcedure = ClinicalAttribution & {
  id?: string;
  label: string;
  ops_code: string | null;
  performed_on: string | null;
  note: string | null;
};

export type ClinicalNarrative = {
  /** Server uuid of this version; null/absent for a brand-new version. */
  id?: string | null;
  anamnese_aktuelle: string | null;
  anamnese_vorgeschichte: string | null;
  anamnese_vegetative: string | null;
  anamnese_sozial: string | null;
  beurteilung: string | null;
  verlauf: string | null;
  /** Whether this is the active version for the patient. */
  is_active: boolean;
  /** Read-only timestamps returned by the server. */
  created_at?: string | null;
  updated_at?: string | null;
};

export type PatientClinicalProfile = {
  diagnoses: ClinicalDiagnosis[];
  medications: ClinicalMedication[];
  examinations: ClinicalExamination[];
  procedures: ClinicalProcedure[];
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

/** A doctor at any active provider, used for the diagnosis "treating doctor" picker. */
export type AllDoctorOption = {
  id: string;
  name: string;
  title: string | null;
  fachbereich: string | null;
  provider_id: string | null;
  provider_name: string | null;
};

export function fetchAllDoctors() {
  return apiFetch<AllDoctorOption[]>("/doctors");
}

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

export function savePatientProcedures(patientId: string, items: ClinicalProcedure[]) {
  return postJson(`/patients/${patientId}/procedures`, { items });
}

export function savePatientNarrative(patientId: string, narrative: ClinicalNarrative) {
  return postJson<ClinicalNarrative>(`/patients/${patientId}/narrative`, {
    id: narrative.id ?? null,
    anamnese_aktuelle: narrative.anamnese_aktuelle,
    anamnese_vorgeschichte: narrative.anamnese_vorgeschichte,
    anamnese_vegetative: narrative.anamnese_vegetative,
    anamnese_sozial: narrative.anamnese_sozial,
    beurteilung: narrative.beurteilung,
    verlauf: narrative.verlauf,
    is_active: narrative.is_active,
  });
}

export function fetchNarrativeHistory(patientId: string) {
  return apiFetch<ClinicalNarrative[]>(`/patients/${patientId}/narrative/history`);
}

export function blankNarrative(): ClinicalNarrative {
  return {
    anamnese_aktuelle: null,
    anamnese_vorgeschichte: null,
    anamnese_vegetative: null,
    anamnese_sozial: null,
    beurteilung: null,
    verlauf: null,
    is_active: true,
  };
}
