import { apiFetch } from "@/lib/api";
import type {
  MedicationDrugMatchResponse,
  MedicationEquivalentPayload,
} from "@/lib/api/clinical";

type JsonPayload = Record<string, unknown>;
export type ClinicalSaveMode = "replace" | "merge";

function clinicalSavePath(path: string, mode: ClinicalSaveMode) {
  return mode === "merge" ? `${path}?mode=merge` : path;
}

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
/** Lifecycle status of a medication on the plan. */
export type MedicationStatus = "aktiv" | "pausiert" | "abgesetzt" | "geplant";
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

/** Allergy vs. general CAVE warning. */
export type ClinicalWarningKind = "allergie" | "cave";

export type ClinicalWarning = {
  /** Server uuid; null/absent for a newly added entry. */
  id?: string | null;
  kind: ClinicalWarningKind;
  /** Allergen name / warning text; REQUIRED. */
  label: string;
  /** Allergy reaction; allergie only. */
  reaction: string | null;
  /** Free text severity (e.g. leicht/mittel/schwer); allergie only, optional. */
  severity: string | null;
  note: string | null;
};

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
  /** Episode (case) this entry was established in, if any. */
  case_id?: string | null;
  /** Client id; for existing nodes cid === id, FE-generated for new ones. */
  cid?: string;
  /** Client parent reference used on SAVE. */
  parent_cid?: string | null;
  /** Server parent uuid, read-only, returned by GET. */
  parent_id?: string | null;
  kind: DiagnosisNodeKind;
  label: string;
  /** Shared medical-specialization directory entries assigned to this diagnosis. */
  specialization_ids?: string[];
  specializations?: import("@/pages/providers/model/types").SpecializationItem[];
  certainty: DiagnosisCertainty | null;
  chronifizierung: DiagnosisChronification | null;
  icd_code: string | null;
  ops_code: string | null;
  diagnosed_on: string | null;
  note: string | null;
  /** Free-text warning signs requiring special attention. */
  red_flags?: string | null;
  source_document_id?: string | null;
  source_document_name?: string | null;
  source_import_id?: string | null;
  source_candidate_id?: string | null;
  source_mode: "intern" | "extern";
  /** Extern attribution; external_country is an ISO 3166-1 alpha-2 code. */
  external_clinic: string | null;
  external_doctor: string | null;
  external_country: string | null;
  treating_doctor_id: string | null;
  treating_doctor_name: string | null;
  treating_doctor_title: string | null;
  treating_doctor_fachbereich?: string | null;
  treating_none: boolean;
  /** Legacy fields, kept optional for back-compat; the new UI ignores them. */
  status?: DiagnosisStatus;
  grade?: string | null;
  laterality?: DiagnosisLaterality | null;
};

export type ClinicalMedication = ClinicalAttribution & {
  id?: string;
  medication_series_id?: string | null;
  supersedes_medication_id?: string | null;
  regimen_fingerprint?: string | null;
  source_country?: string | null;
  source_date?: string | null;
  source_page?: number | null;
  source_document_id?: string | null;
  source_document_name?: string | null;
  source_import_id?: string | null;
  source_candidate_id?: string | null;
  category: MedicationCategory;
  wirkstoff: string | null;
  handelsname: string;
  staerke: string | null;
  /** Darreichungsform (dosage form); UI relabels this to "Darreichungsform". */
  form: string | null;
  /** Einnahmeform (route of administration); REQUIRED in the UI. */
  einnahmeform: string | null;
  dose_morgens: string | null;
  dose_mittags: string | null;
  dose_abends: string | null;
  dose_nachts: string | null;
  einheit: string | null;
  hinweis: string | null;
  grund: string | null;
  /** Prescription date (YYYY-MM-DD); the prescribing doctor is the provider/doctor attribution. */
  verordnet_am: string | null;
  /** Intake start date (YYYY-MM-DD). */
  einnahme_von: string | null;
  /** Intake end date (YYYY-MM-DD). */
  einnahme_bis: string | null;
  status: MedicationStatus;
  apothekenpflichtig: boolean;
  rezeptpflichtig: boolean;
  /** Betäubungsmittel (narcotic). */
  btm: boolean;
  aut_idem_sperre: boolean;
  abgabebeschraenkung: boolean;
  /** Free-text notes shown when the "Sonstige Vermerke" checkbox is on. */
  sonstige_vermerke: string | null;
  on_hold: boolean;
  /** Date from which the patient stopped taking the medication (YYYY-MM-DD). */
  hold_from?: string | null;
  hold_until: string | null;
  hold_note: string | null;
};

export type ClinicalExamination = ClinicalAttribution & {
  id?: string;
  /** Episode (case) this entry was established in, if any. */
  case_id?: string | null;
  kind: ExaminationKind | null;
  title: string;
  performed_on: string | null;
  status: ExaminationStatus;
  result: string | null;
  note: string | null;
  red_flags?: string | null;
  source_document_id?: string | null;
  source_document_name?: string | null;
  source_import_id?: string | null;
  source_candidate_id?: string | null;
  specialization_ids?: string[];
  specializations?: import("@/pages/providers/model/types").SpecializationItem[];
};

export type ClinicalProcedure = ClinicalAttribution & {
  id?: string;
  /** Episode (case) this entry was established in, if any. */
  case_id?: string | null;
  label: string;
  ops_code: string | null;
  performed_on: string | null;
  note: string | null;
};

export type ClinicalNarrative = {
  /** Server uuid of this version; null/absent for a brand-new version. */
  id?: string | null;
  /** Episode (case) this version was taken in, if any. */
  case_id?: string | null;
  anamnese_aktuelle: string | null;
  anamnese_vorgeschichte: string | null;
  anamnese_vegetative: string | null;
  anamnese_sozial: string | null;
  beurteilung: string | null;
  red_flags?: string | null;
  source_document_id?: string | null;
  source_document_name?: string | null;
  source_import_id?: string | null;
  specialization_ids?: string[];
  specializations?: ClinicalNarrativeSpecialization[];
  /** Clinical date and time of this anamnesis version (RFC 3339). */
  anamnese_at?: string | null;
  /** Whether this is the active version for the patient. */
  is_active: boolean;
  /** Read-only timestamps returned by the server. */
  created_at?: string | null;
  updated_at?: string | null;
};

export type ClinicalNarrativeSpecialization =
  import("@/pages/providers/model/types").SpecializationItem & {
    narrative_text: string | null;
    assessment_text: string | null;
  };

export type ClinicalVerlaufEntry = ClinicalAttribution & {
  /** Server uuid; null/absent for a newly added entry. */
  id?: string | null;
  /** Episode (case) this entry was established in, if any. */
  case_id?: string | null;
  source_document_id?: string | null;
  source_document_name?: string | null;
  source_import_id?: string | null;
  source_candidate_id?: string | null;
  source_page?: number | null;
  occurred_on: string | null;
  note: string;
};

export type PatientImpfstatus = {
  status_text: string | null;
  updated_at?: string | null;
};

export type PatientClinicalProfile = {
  diagnoses: ClinicalDiagnosis[];
  medications: ClinicalMedication[];
  examinations: ClinicalExamination[];
  procedures: ClinicalProcedure[];
  verlauf: ClinicalVerlaufEntry[];
  narrative: ClinicalNarrative | null;
  allergien: ClinicalWarning[];
  cave: ClinicalWarning[];
  impfstatus?: PatientImpfstatus | null;
};

/** Empfehlung outcome lifecycle, independent of the existing `status` field. */
export type RecommendationLifecycleStatus =
  | "aktiv"
  | "erfolg"
  | "nicht_erfolgt"
  | "unbekannt";

export type PatientRecommendation = {
  id: string;
  title: string;
  description: string | null;
  recommendation_type: string | null;
  source_doctor_id: string | null;
  source_doctor_name: string | null;
  source_doctor_title: string | null;
  source_doctor_fachbereich: string | null;
  due_at: string | null;
  priority: string | null;
  status: string | null;
  /** Date the recommendation was made (YYYY-MM-DD). */
  recommended_on: string | null;
  /** Validity period start/end (YYYY-MM-DD). */
  valid_from: string | null;
  valid_to: string | null;
  /** Remind this many days before `valid_to` when only an end date is set. */
  reminder_lead_days: number | null;
  /** Explicit reminder date (YYYY-MM-DD). */
  reminder_at: string | null;
  lifecycle_status: RecommendationLifecycleStatus;
  /** Note for erfolg / nicht_erfolgt / unbekannt outcomes. */
  outcome_note: string | null;
  /** Completion date for the erfolg outcome (YYYY-MM-DD). */
  outcome_at: string | null;
  /** Internal staff-only note. */
  note_intern: string | null;
  source_document_id?: string | null;
  source_document_name?: string | null;
};

/** Writable fields accepted by create/update; all optional on update. */
export type PatientRecommendationInput = Partial<
  Pick<
    PatientRecommendation,
    | "title"
    | "description"
    | "recommendation_type"
    | "source_doctor_id"
    | "due_at"
    | "priority"
    | "recommended_on"
    | "valid_from"
    | "valid_to"
    | "reminder_lead_days"
    | "reminder_at"
    | "lifecycle_status"
    | "outcome_note"
    | "outcome_at"
    | "note_intern"
  >
> & {
  source_document_id?: string | null;
  source_appointment_id?: string | null;
  source_order_id?: string | null;
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

export function deduplicateAllDoctorOptions(doctors: AllDoctorOption[]): AllDoctorOption[] {
  const byId = new Map<string, { doctor: AllDoctorOption; providerNames: string[] }>();
  for (const doctor of doctors) {
    const providerName = doctor.provider_name?.trim();
    const existing = byId.get(doctor.id);
    if (!existing) {
      byId.set(doctor.id, {
        doctor,
        providerNames: providerName ? [providerName] : [],
      });
      continue;
    }
    if (providerName && !existing.providerNames.includes(providerName)) {
      existing.providerNames.push(providerName);
    }
  }
  return Array.from(byId.values()).map(({ doctor, providerNames }) => ({
    ...doctor,
    provider_name: providerNames.length > 0 ? providerNames.join(", ") : doctor.provider_name,
  }));
}

export function fetchAllDoctors() {
  return apiFetch<AllDoctorOption[]>("/doctors", { cacheTtlMs: 60_000 })
    .then(deduplicateAllDoctorOptions);
}

export function fetchPatientClinical(patientId: string) {
  return apiFetch<PatientClinicalProfile>(`/patients/${patientId}/clinical`);
}

export function fetchPatientRecommendations(patientId: string) {
  return apiFetch<PatientRecommendation[]>(`/patients/${patientId}/recommendations`);
}

export function createPatientRecommendation(
  patientId: string,
  payload: PatientRecommendationInput,
) {
  return postJson<PatientRecommendation>(
    "/patients/" + patientId + "/recommendations",
    payload,
  );
}

export function updatePatientRecommendation(
  patientId: string,
  recommendationId: string,
  payload: PatientRecommendationInput,
) {
  return postJson<PatientRecommendation>(
    "/patients/" + patientId + "/recommendations/" + recommendationId + "/update",
    payload,
  );
}

export function deletePatientRecommendation(
  patientId: string,
  recommendationId: string,
) {
  return postJson(
    "/patients/" + patientId + "/recommendations/" + recommendationId + "/delete",
  );
}

export function savePatientDiagnoses(
  patientId: string,
  items: ClinicalDiagnosis[],
  mode: ClinicalSaveMode = "replace",
) {
  return postJson(clinicalSavePath(`/patients/${patientId}/diagnoses`, mode), { items });
}

export function savePatientMedications(
  patientId: string,
  items: ClinicalMedication[],
  mode: ClinicalSaveMode = "replace",
) {
  return postJson(clinicalSavePath(`/patients/${patientId}/medications`, mode), { items });
}

export function savePatientExaminations(patientId: string, items: ClinicalExamination[]) {
  return postJson(`/patients/${patientId}/examinations`, { items });
}

export function savePatientProcedures(patientId: string, items: ClinicalProcedure[]) {
  return postJson(`/patients/${patientId}/procedures`, { items });
}

export function savePatientClinicalWarnings(
  patientId: string,
  kind: ClinicalWarningKind,
  items: ClinicalWarning[],
  mode: ClinicalSaveMode = "replace",
) {
  return postJson(
    clinicalSavePath(`/patients/${patientId}/clinical-warnings`, mode),
    { kind, items },
  );
}

export function patientNarrativePayload(narrative: ClinicalNarrative): JsonPayload {
  const selectedById = new Map(
    (narrative.specializations ?? []).map((item) => [item.id, item]),
  );
  const specializationIds =
    narrative.specialization_ids ??
    (narrative.specializations ?? []).map((item) => item.id);

  return {
    id: narrative.id ?? null,
    case_id: narrative.case_id ?? null,
    anamnese_aktuelle: narrative.anamnese_aktuelle,
    anamnese_vorgeschichte: narrative.anamnese_vorgeschichte,
    anamnese_vegetative: narrative.anamnese_vegetative,
    anamnese_sozial: narrative.anamnese_sozial,
    beurteilung: narrative.beurteilung,
    red_flags: narrative.red_flags ?? null,
    specialization_ids: specializationIds,
    specializations: specializationIds.map((specializationId) => {
      const item = selectedById.get(specializationId);
      return {
        specialization_id: specializationId,
        narrative_text: item?.narrative_text ?? null,
        assessment_text: item?.assessment_text ?? null,
      };
    }),
    anamnese_at: narrative.anamnese_at ?? null,
    is_active: narrative.is_active,
  };
}

export function savePatientNarrative(patientId: string, narrative: ClinicalNarrative) {
  return postJson<ClinicalNarrative>(
    `/patients/${patientId}/narrative`,
    patientNarrativePayload(narrative),
  );
}

export function deletePatientNarrative(patientId: string, narrativeId: string) {
  return postJson<ClinicalNarrative | null>(
    `/patients/${patientId}/narrative/${narrativeId}/delete`,
  );
}

export function savePatientVerlauf(patientId: string, items: ClinicalVerlaufEntry[]) {
  return postJson(`/patients/${patientId}/verlauf`, {
    items: items.map((item) => ({
      case_id: item.case_id ?? null,
      provider_id: item.provider_id,
      doctor_id: item.doctor_id,
      occurred_on: item.occurred_on,
      note: item.note,
    })),
  });
}

export function fetchPatientImpfstatus(patientId: string) {
  return apiFetch<{ impfstatus: PatientImpfstatus | null }>(
    `/patients/${patientId}/impfstatus`,
  );
}

export function savePatientImpfstatus(patientId: string, statusText: string | null) {
  return postJson(`/patients/${patientId}/impfstatus`, {
    status_text: statusText,
  });
}

export function fetchNarrativeHistory(patientId: string) {
  return apiFetch<ClinicalNarrative[]>(`/patients/${patientId}/narrative/history`);
}

export function fetchPatientMedicationEquivalents(
  patientId: string,
  medicationId: string,
  includeCandidates = false,
) {
  const query = includeCandidates ? "?include_candidates=true" : "";
  return apiFetch<MedicationEquivalentPayload>(
    `/patients/${patientId}/medications/${medicationId}/equivalents${query}`,
  );
}

export function createPatientMedicationDrugMatch(
  patientId: string,
  medicationId: string,
  body: {
    drug_product_id: string;
    confidence?: number | null;
    note?: string | null;
  },
) {
  return postJson<MedicationDrugMatchResponse>(
    `/patients/${patientId}/medications/${medicationId}/drug-matches`,
    body,
  );
}

export function verifyPatientMedicationDrugMatch(
  patientId: string,
  medicationId: string,
  matchId: string,
  verificationStatus: "candidate" | "verified" | "rejected",
  note?: string | null,
) {
  return postJson(
    `/patients/${patientId}/medications/${medicationId}/drug-matches/${matchId}/verify`,
    { verification_status: verificationStatus, note: note ?? null },
  );
}

export function confirmPatientMedicationExpiry(
  patientId: string,
  medicationId: string,
) {
  return postJson(
    `/patients/${patientId}/medications/${medicationId}/expiry-confirm`,
  );
}

export function blankNarrative(): ClinicalNarrative {
  return {
    anamnese_aktuelle: null,
    anamnese_vorgeschichte: null,
    anamnese_vegetative: null,
    anamnese_sozial: null,
    beurteilung: null,
    anamnese_at: new Date().toISOString(),
    is_active: true,
  };
}
