import { apiFetch, clearApiCache } from "@/lib/api";
import type { ConsentFormChoices, ConsentRecipient, StaffConsentChannel } from "@/pages/patient-lead/lead-request-api";

/** One saved change of the consent choices, newest first. */
export type PatientConsentHistoryEntry = {
  id: string;
  chosen_at: string;
  /** `lead_portal` / `staff_recorded` / `staff_correction` (lead), `patient_staff`, `patient_portal`. */
  source: string;
  access_kind: string;
  recorded_how: StaffConsentChannel | null;
  recorded_note?: string | null;
  chosen_by_name?: string | null;
  choices: ConsentFormChoices;
  recipients_count: number;
  /** A signed consent form records this choice. */
  signed: boolean;
};

export type PatientConsentDocument = {
  id: string;
  template_id: string | null;
  title: string | null;
  signed_at: string | null;
  created_at: string;
  /** The form does not print the newest choice yet. */
  needs_new_version: boolean;
};

/** `GET /patients/{id}/consent-choices` and `GET /me/consent-choices` (owner request 2026-11-16). */
export type PatientConsentState = {
  patient_id: string;
  version: string;
  max_recipients: number;
  minor: boolean;
  can_edit: boolean;
  /** The newest choice: what the next consent form prints. */
  requested: {
    id: string;
    choices: ConsentFormChoices;
    recipients: ConsentRecipient[];
    disclosure_consent_given: boolean;
  } | null;
  /** What applies now: removals at once, additions once signed. */
  effective: { choices: ConsentFormChoices; recipients: ConsentRecipient[] };
  /** Additions of the newest choice that wait for the signature. */
  pending: { options: (keyof ConsentFormChoices)[]; recipients: boolean[] };
  history: PatientConsentHistoryEntry[];
  documents: PatientConsentDocument[];
  disclosure_text: string;
  saved_id?: string;
};

export type PatientConsentChange = {
  choices: ConsentFormChoices;
  recipients: ConsentRecipient[];
  consent_given: boolean;
  version: string;
  language: string;
  recorded_how?: StaffConsentChannel;
  recorded_note?: string;
};

const staffPath = (patientId: string) => `/patients/${encodeURIComponent(patientId)}/consent-choices`;

/** Staff (`patientId`) or the patient's own portal (`null`). */
export function fetchPatientConsentState(patientId: string | null, lang: string): Promise<PatientConsentState> {
  const path = patientId ? staffPath(patientId) : "/me/consent-choices";
  return apiFetch<PatientConsentState>(`${path}?lang=${encodeURIComponent(lang)}`, { forceFresh: true });
}

export async function savePatientConsentChange(patientId: string | null, change: PatientConsentChange): Promise<PatientConsentState> {
  const saved = await apiFetch<PatientConsentState>(patientId ? staffPath(patientId) : "/me/consent-choices", {
    method: "POST",
    body: JSON.stringify(change),
  });
  clearApiCache("/documents");
  clearApiCache("/patients");
  return saved;
}
