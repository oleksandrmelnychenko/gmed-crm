import { apiFetch } from "@/lib/api";

/** A login created or a new password issued; the password is shown once. */
export type PatientPortalAccessIssued = {
  user_id: string;
  email: string | null;
  created: boolean;
  one_time_password: string;
};

/**
 * Creates the patient's portal login with a generated password, or issues a
 * new password for the linked login (CEO and patient managers).
 */
export function issuePatientPortalAccess(patientId: string) {
  return apiFetch<PatientPortalAccessIssued>(`/patients/${patientId}/portal-account`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
