import { ApiRequestError, isLocalizedApiError } from "@/lib/api";
import type { Translations } from "@/lib/i18n";

export type ConsentAction = "grant" | "revoke";

/**
 * The DSGVO register refusals of `routes/admin_compliance.rs` (review,
 * steps, execution) carry only an English sentence and the HTTP reason; the
 * page shows them in the UI language (QA round 2, group E). Coded refusals
 * (`erasure_blocked_by_retention` …) are translated by `apiFetch` already.
 */
const PRIVACY_REQUEST_ERROR_KEYS: Record<string, string> = {
  "Privacy request must be approved before execution": "compliance_error_not_approved",
  "Only CEO or IT admin can execute this privacy request type": "compliance_error_execute_role",
  "Verify and record the requester's identity before executing this request":
    "compliance_error_identity_required",
  "Privacy request was already executed": "compliance_error_already_executed",
  "Unknown privacy request type": "compliance_error_unknown_type",
  "Privacy request not found": "compliance_error_not_found",
  "Patient not found": "compliance_error_not_found",
  "Rejecting a request needs a reason of at least 10 characters for the data subject":
    "compliance_error_reason_required",
  "Revising an approved request needs a reason of at least 10 characters":
    "compliance_error_reason_required",
  "An extension needs a reason of at least 10 characters": "compliance_error_reason_required",
  "The reason must be between 10 and 2000 characters": "compliance_error_reason_required",
  "reason must be between 10 and 2000 characters": "compliance_error_reason_required",
  "Only CEO or IT admin can revise an approved privacy request": "compliance_error_revise_role",
  "Privacy request can no longer be reviewed": "compliance_error_closed",
  "Privacy request is already closed": "compliance_error_closed",
  "Privacy request is already approved": "compliance_error_already_approved",
  "The deadline of this request was already extended once": "compliance_error_extended_once",
  "Privacy review action is invalid": "compliance_error_invalid_input",
  "Unknown step": "compliance_error_invalid_input",
  "Unknown identity verification method": "compliance_error_invalid_input",
  "Unknown notification channel": "compliance_error_invalid_input",
};

export function privacyRequestErrorMessage(error: unknown, t: Translations): string {
  if (isLocalizedApiError(error)) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  const key = PRIVACY_REQUEST_ERROR_KEYS[message.trim()];
  if (key && t.uiText[key]) return t.uiText[key];
  if (error instanceof ApiRequestError && error.status === 403) return t.uiText.compliance_error_forbidden;
  if (error instanceof ApiRequestError && (error.status ?? 0) >= 500) return t.uiText.compliance_error_failed;
  return message || t.uiText.compliance_error_failed;
}

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

/**
 * Roles the server lets produce the data export of Art. 15 — it contains the
 * clinical record: CEO and patient manager (`export_patient_data` in
 * `routes/admin_compliance.rs`). Everyone else, the IT admin included, gets
 * the hint instead of a button that answers 403 (QA E2-08).
 */
const PATIENT_EXPORT_ROLES = new Set(["ceo", "patient_manager"]);

export function canExportPatientData(role: string | null | undefined): boolean {
  return PATIENT_EXPORT_ROLES.has(role ?? "");
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
