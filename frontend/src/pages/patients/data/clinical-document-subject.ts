export type ClinicalDocumentSubjectEvidence = {
  status?: "extracted" | "conflict";
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  patient_identifier?: string | null;
  patient_identifier_namespace?: "source_document" | "gmed_patient_id" | null;
  conflict?: boolean;
  field_confidence?: Record<string, number>;
  source?: {
    page?: number | null;
    text?: string | null;
  } | null;
  source_page?: number | null;
  source_text?: string | null;
  review_reasons?: string[];
};

export type PatientIdentityReference = {
  firstName?: string | null;
  lastName?: string | null;
  birthDate?: string | null;
  patientIdentifier?: string | null;
};

export type ClinicalDocumentSubjectCheck = {
  status: "verified" | "unavailable" | "confirmation_required" | "hard_mismatch";
  reasons: Array<
    | "conflicting_subjects"
    | "birth_date_mismatch"
    | "identifier_mismatch"
    | "external_identifier_mismatch"
    | "identifier_namespace_invalid"
    | "name_mismatch"
  >;
};

export type ClinicalDocumentIdentityPrepareMode =
  | "review_required"
  | "legacy_applying"
  | "frozen_applying"
  | "not_applicable";

export function clinicalDocumentIdentityPrepareMode(
  status: string | null | undefined,
  preparedIdentityGateVersion: number | null | undefined,
): ClinicalDocumentIdentityPrepareMode {
  if (status === "review_required") return "review_required";
  if (status !== "applying") return "not_applicable";
  return (preparedIdentityGateVersion ?? 0) === 0
    ? "legacy_applying"
    : "frozen_applying";
}

export function clinicalDocumentIdentityConfirmationForPrepare({
  mode,
  preparedIdentityConfirmed,
  newlyConfirmed,
}: {
  mode: ClinicalDocumentIdentityPrepareMode;
  preparedIdentityConfirmed: boolean | null | undefined;
  newlyConfirmed: boolean;
}): boolean {
  const stored = preparedIdentityConfirmed ?? false;
  return mode === "frozen_applying" ? stored : stored || newlyConfirmed;
}

export function clinicalDocumentIdentityRequiresCurrentDecision(
  mode: ClinicalDocumentIdentityPrepareMode,
): boolean {
  return mode === "review_required" || mode === "legacy_applying";
}

export function clinicalDocumentIdentityConfirmationVisible(
  mode: ClinicalDocumentIdentityPrepareMode,
  subjectStatus: ClinicalDocumentSubjectCheck["status"],
): boolean {
  return clinicalDocumentIdentityRequiresCurrentDecision(mode)
    && clinicalDocumentIdentityNeedsExplicitConfirmation(subjectStatus);
}

export function clinicalDocumentIdentityNeedsExplicitConfirmation(
  subjectStatus: ClinicalDocumentSubjectCheck["status"],
): boolean {
  return subjectStatus === "confirmation_required" || subjectStatus === "unavailable";
}

function normalizedName(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/\s+/g, " ");
}

function normalizedIdentifier(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function checkClinicalDocumentSubject(
  subject: ClinicalDocumentSubjectEvidence | null | undefined,
  patient: PatientIdentityReference,
): ClinicalDocumentSubjectCheck {
  if (!subject) return { status: "unavailable", reasons: [] };

  const reasons: ClinicalDocumentSubjectCheck["reasons"] = [];
  if (subject.conflict || subject.status === "conflict") reasons.push("conflicting_subjects");
  if (subject.birth_date && patient.birthDate && subject.birth_date !== patient.birthDate) {
    reasons.push("birth_date_mismatch");
  }
  const subjectIdentifier = normalizedIdentifier(subject.patient_identifier);
  const patientIdentifier = normalizedIdentifier(patient.patientIdentifier);
  const identifierNamespace = subject.patient_identifier_namespace ?? "source_document";
  const hasKnownIdentifierNamespace = identifierNamespace === "source_document"
    || identifierNamespace === "gmed_patient_id";
  const hasIdentifierMismatch = Boolean(
    subjectIdentifier && patientIdentifier && subjectIdentifier !== patientIdentifier,
  );
  if (subjectIdentifier && !hasKnownIdentifierNamespace) {
    reasons.push("identifier_namespace_invalid");
  } else if (hasIdentifierMismatch && identifierNamespace === "gmed_patient_id") {
    reasons.push("identifier_mismatch");
  } else if (hasIdentifierMismatch) {
    reasons.push("external_identifier_mismatch");
  }

  const subjectFirst = normalizedName(subject.first_name);
  const subjectLast = normalizedName(subject.last_name);
  const patientFirst = normalizedName(patient.firstName);
  const patientLast = normalizedName(patient.lastName);
  const hasComparableName = Boolean(subjectFirst && subjectLast && patientFirst && patientLast);
  const hasFirstNameMismatch = Boolean(
    subjectFirst && patientFirst && subjectFirst !== patientFirst,
  );
  const hasLastNameMismatch = Boolean(
    subjectLast && patientLast && subjectLast !== patientLast,
  );
  if (hasFirstNameMismatch || hasLastNameMismatch) {
    reasons.push("name_mismatch");
  }

  if (
    reasons.some((reason) => !["name_mismatch", "external_identifier_mismatch"].includes(reason))
  ) {
    return { status: "hard_mismatch", reasons };
  }
  if (reasons.includes("name_mismatch") || reasons.includes("external_identifier_mismatch")) {
    return { status: "confirmation_required", reasons };
  }
  if (
    hasComparableName ||
    (Boolean(subject.birth_date) && Boolean(patient.birthDate)) ||
    (identifierNamespace === "gmed_patient_id"
      && Boolean(subjectIdentifier)
      && Boolean(patientIdentifier))
  ) {
    return { status: "verified", reasons: [] };
  }
  return { status: "unavailable", reasons: [] };
}
