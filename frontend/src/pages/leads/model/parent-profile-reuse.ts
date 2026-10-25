type BasicDraft = {
  birthDate: string;
  phone: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  citizenships: string[];
};
type BasicProfile = {
  date_of_birth?: string | null;
  phone?: string | null;
  street_address?: string | null;
  zip_code?: string | null;
  city?: string | null;
  country?: string | null;
  citizenships?: string[] | null;
};

/** A new own request may inherit known basic identity, never clinical answers
 * or consents. Explicit staff input, including typing during creation, wins. */
export function fillMissingParentProfile<Draft extends BasicDraft>(draft: Draft, profile: BasicProfile): Draft {
  return {
    ...draft,
    birthDate: draft.birthDate || profile.date_of_birth || "",
    phone: draft.phone.trim() ? draft.phone : profile.phone || "",
    street: draft.street.trim() ? draft.street : profile.street_address || "",
    zip: draft.zip.trim() ? draft.zip : profile.zip_code || "",
    city: draft.city.trim() ? draft.city : profile.city || "",
    country: draft.country.trim() ? draft.country : profile.country || "",
    citizenships: draft.citizenships.length ? draft.citizenships : profile.citizenships ?? [],
  };
}

/** The server exposes a patient id only after staff record-access validation. */
export function existingParentPatientFromError(error: unknown): { patientId: string | null } | null {
  if (!error || typeof error !== "object" || !("body" in error)) return null;
  const body = error.body;
  if (!body || typeof body !== "object" || !("code" in body)
    || body.code !== "existing_parent_patient_use_repeat_intake") return null;
  // `patient_id` from the guardian-login case, `existing_patient_id` from a
  // source person that already has an own patient record (2026-10-25).
  for (const key of ["patient_id", "existing_patient_id"] as const) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) return { patientId: value };
  }
  return { patientId: null };
}
