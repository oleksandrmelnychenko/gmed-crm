export type ConsentAction = "grant" | "revoke";

export function buildConsentFormPatchAfterSuccess(action: ConsentAction) {
  if (action === "revoke") {
    return {
      consentExpiresAt: "",
      consentNote: "",
    };
  }

  return {
    consentNote: "",
  };
}

/**
 * The UI text key that says how a privacy request reached the register, or
 * null when the plain source label fits. A request the data subject made is
 * told apart by its channel: the patient portal, or staff who recorded it
 * from a letter, call or visit (QA B-23 c).
 */
export function privacySourceUiKey(
  source: string,
  createdVia?: string | null,
): string | null {
  if (createdVia === "retention_sweep") return "privacy_source_retention_sweep";
  if (createdVia === "legacy_anonymize_endpoint") return "privacy_source_direct_erasure";
  if (source === "patient_request") {
    return createdVia === "patient_self_service"
      ? "privacy_source_patient_request_portal"
      : "privacy_source_patient_request_staff";
  }
  return null;
}

export type PatientLabelSource = {
  patient_pid?: string | null;
  patient_name?: string | null;
};

/** "P-… - Name"; the number or the name alone when only one is known. */
export function patientLabel(patientPid?: string | null, patientName?: string | null) {
  const normalizedName = patientName?.trim();
  const normalizedPid = patientPid?.trim();
  if (normalizedPid && normalizedName) {
    return `${normalizedPid} - ${normalizedName}`;
  }
  return normalizedPid || normalizedName || "";
}

/**
 * The name and number of the patient the register is loaded for, never the
 * raw record id: from the patient picker, else from a request of the
 * patient, else from the loaded patient record (QA B-23 b).
 */
export function resolveActivePatientLabel(
  patientId: string,
  options: ReadonlyArray<{ id: string; label: string }>,
  requests: ReadonlyArray<PatientLabelSource & { patient_id?: string }>,
  loaded?: PatientLabelSource | null,
): string {
  if (!patientId) return "";
  const option = options.find((candidate) => candidate.id === patientId);
  if (option?.label.trim()) return option.label;
  const request = requests.find(
    (candidate) => !candidate.patient_id || candidate.patient_id === patientId,
  );
  const fromRequest = request ? patientLabel(request.patient_pid, request.patient_name) : "";
  if (fromRequest) return fromRequest;
  return loaded ? patientLabel(loaded.patient_pid, loaded.patient_name) : "";
}
