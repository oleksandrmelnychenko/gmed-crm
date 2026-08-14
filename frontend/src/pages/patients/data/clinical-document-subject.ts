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
  status:
    | "verified"
    | "verified_variant"
    | "unavailable"
    | "profile_incomplete"
    | "confirmation_required"
    | "hard_mismatch";
  nameMatch: "exact" | "german_variant" | "mismatch" | "unavailable";
  reasons: Array<
    | "conflicting_subjects"
    | "birth_date_mismatch"
    | "identifier_mismatch"
    | "identifier_namespace_invalid"
    | "patient_profile_incomplete"
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
  return subjectStatus === "confirmation_required"
    || subjectStatus === "unavailable"
    || subjectStatus === "profile_incomplete";
}

const identityTitleTokens = new Set([
  "dr",
  "dent",
  "dipl",
  "doktor",
  "frau",
  "fraulein",
  "fräulein",
  "habil",
  "herr",
  "herrn",
  "med",
  "md",
  "nat",
  "patient",
  "patientin",
  "phd",
  "prof",
  "professor",
  "rer",
]);

function identityNameTokens(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/[\u2018\u2019\u02bc'`´.,_\-/]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function normalizedName(value: string | null | undefined) {
  const tokens = identityNameTokens(value);
  while (tokens.length > 0 && identityTitleTokens.has(tokens[0])) tokens.shift();
  return tokens.join(" ");
}

function germanCanonicalName(value: string | null | undefined) {
  return normalizedName(value)
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss");
}

function normalizedIdentifier(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function namePartMatch(
  subjectValue: string | null | undefined,
  patientValue: string | null | undefined,
): ClinicalDocumentSubjectCheck["nameMatch"] {
  const subject = normalizedName(subjectValue);
  const patient = normalizedName(patientValue);
  if (!subject || !patient) return "unavailable";
  if (subject === patient) return "exact";
  if (germanCanonicalName(subject) === germanCanonicalName(patient)) {
    return "german_variant";
  }
  return "mismatch";
}

function combinedNameMatch(
  subject: ClinicalDocumentSubjectEvidence,
  patient: PatientIdentityReference,
): ClinicalDocumentSubjectCheck["nameMatch"] {
  const first = namePartMatch(subject.first_name, patient.firstName);
  const last = namePartMatch(subject.last_name, patient.lastName);
  const hasBothNames = Boolean(
    normalizedName(subject.first_name)
      && normalizedName(subject.last_name)
      && normalizedName(patient.firstName)
      && normalizedName(patient.lastName),
  );

  if (hasBothNames && (first === "mismatch" || last === "mismatch")) {
    const swappedFirst = namePartMatch(subject.first_name, patient.lastName);
    const swappedLast = namePartMatch(subject.last_name, patient.firstName);
    if (
      swappedFirst !== "mismatch"
      && swappedFirst !== "unavailable"
      && swappedLast !== "mismatch"
      && swappedLast !== "unavailable"
    ) {
      return "german_variant";
    }
  }

  if (first === "mismatch" || last === "mismatch") return "mismatch";
  if (first === "german_variant" || last === "german_variant") return "german_variant";
  if (first === "exact" && last === "exact") return "exact";
  return "unavailable";
}

export function patientIdentityNameIsPlaceholder(patient: PatientIdentityReference) {
  const first = normalizedName(patient.firstName);
  const last = normalizedName(patient.lastName);
  if (!first || !last) return true;
  const compactFirst = first.replace(/\s+/g, "");
  const compactLast = last.replace(/\s+/g, "");
  return /^\d{4,}$/.test(compactFirst)
    && /^\d{4,}$/.test(compactLast);
}

export function checkClinicalDocumentSubject(
  subject: ClinicalDocumentSubjectEvidence | null | undefined,
  patient: PatientIdentityReference,
): ClinicalDocumentSubjectCheck {
  const unavailableName = { nameMatch: "unavailable" as const };
  if (!subject) {
    return patientIdentityNameIsPlaceholder(patient)
      ? {
          status: "profile_incomplete",
          reasons: ["patient_profile_incomplete"],
          ...unavailableName,
        }
      : { status: "unavailable", reasons: [], ...unavailableName };
  }

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
  }

  const nameMatch = combinedNameMatch(subject, patient);
  if (nameMatch === "mismatch") reasons.push("name_mismatch");

  if (reasons.some((reason) => reason !== "name_mismatch")) {
    return { status: "hard_mismatch", reasons, nameMatch };
  }
  if (patientIdentityNameIsPlaceholder(patient)) {
    return {
      status: "profile_incomplete",
      reasons: ["patient_profile_incomplete"],
      nameMatch,
    };
  }
  if (reasons.includes("name_mismatch")) {
    return { status: "confirmation_required", reasons, nameMatch };
  }
  const hasComparableName = nameMatch === "exact" || nameMatch === "german_variant";
  if (
    hasComparableName ||
    (Boolean(subject.birth_date) && Boolean(patient.birthDate)) ||
    (identifierNamespace === "gmed_patient_id"
      && Boolean(subjectIdentifier)
      && Boolean(patientIdentifier))
  ) {
    return {
      status: nameMatch === "german_variant" ? "verified_variant" : "verified",
      reasons: [],
      nameMatch,
    };
  }
  return { status: "unavailable", reasons: [], nameMatch };
}
