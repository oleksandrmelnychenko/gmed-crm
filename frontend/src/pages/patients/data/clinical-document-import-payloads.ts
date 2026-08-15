import { COUNTRY_CODES } from "@/components/ui/country-select";

import type {
  ClinicalDocumentCandidatePayloads,
  ClinicalDocumentImportCandidate,
  ImportedLabResultPayload,
  ImportedVitalPayload,
} from "./clinical-document-import";
import { medicationImportPayload } from "./medication-document-import";

const canonicalCountryCodes = new Set(COUNTRY_CODES);

export function isCanonicalClinicalImportSourceCountry(value: unknown): value is string {
  return typeof value === "string" && canonicalCountryCodes.has(value);
}

export function deriveClinicalImportSourceCountry(
  candidates: Pick<ClinicalDocumentImportCandidate, "normalized">[],
): string {
  const rawCountries = candidates
    .map((candidate) => candidate.normalized.source_country)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (rawCountries.some((country) => !isCanonicalClinicalImportSourceCountry(country))) {
    return "";
  }
  const countries = new Set(rawCountries);
  return countries.size === 1 ? [...countries][0] : "";
}

export function labResultImportPayload(
  candidate: ClinicalDocumentImportCandidate,
  sourceCountry: string,
  importId: string,
): ImportedLabResultPayload | null {
  if (candidate.target !== "lab_result" || !isCanonicalClinicalImportSourceCountry(sourceCountry)) {
    return null;
  }
  const normalized = candidate.normalized;
  const analyteName = typeof normalized.analyte_name === "string"
    ? normalized.analyte_name.trim()
    : "";
  const resultText = typeof normalized.result_text === "string"
    ? normalized.result_text.trim()
    : "";
  const measuredAt = typeof normalized.measured_on === "string"
    ? normalized.measured_on.trim()
    : "";
  if (!analyteName || !resultText || !measuredAt || !validClinicalTimestamp(measuredAt)) {
    return null;
  }

  return {
    measured_at: measuredAt,
    panel: typeof normalized.panel === "string" ? normalized.panel : null,
    laboratory_name: typeof normalized.laboratory_name === "string"
      ? normalized.laboratory_name.trim() || null
      : null,
    analyte_name: analyteName,
    result_text: resultText,
    numeric_result: typeof normalized.numeric_result === "number" ? normalized.numeric_result : null,
    comparator: typeof normalized.comparator === "string" ? normalized.comparator : null,
    unit: typeof normalized.unit === "string" ? normalized.unit : null,
    reference_text: typeof normalized.reference_text === "string" ? normalized.reference_text : null,
    reference_low: typeof normalized.reference_low === "number" ? normalized.reference_low : null,
    reference_high: typeof normalized.reference_high === "number" ? normalized.reference_high : null,
    abnormal_flag: typeof normalized.abnormal_flag === "string" ? normalized.abnormal_flag : "unknown",
    source_country: sourceCountry,
    source_import_id: importId,
    source_candidate_id: candidate.id,
    source_page: candidate.source.page,
  };
}

const vitalNumberFields = [
  "bp_systolic",
  "bp_diastolic",
  "heart_rate",
  "temperature_c",
  "oxygen_saturation",
  "respiratory_rate",
  "weight_kg",
  "height_cm",
  "bmi",
] as const;

const vitalRanges: Record<(typeof vitalNumberFields)[number], readonly [number, number]> = {
  bp_systolic: [40, 300],
  bp_diastolic: [20, 200],
  heart_rate: [20, 300],
  temperature_c: [25, 45],
  oxygen_saturation: [20, 100],
  respiratory_rate: [3, 80],
  weight_kg: [1, 500],
  height_cm: [20, 250],
  bmi: [5, 100],
};

export type VitalImportValidationIssue =
  | "missing_date"
  | "invalid_date"
  | "missing_measurement"
  | "invalid_number"
  | "incomplete_blood_pressure"
  | "invalid_blood_pressure"
  | "bmi_conflict"
  | "invalid_source_country"
  | "invalid_source_page";

export type VitalImportValidation = {
  payload: ImportedVitalPayload | null;
  issues: VitalImportValidationIssue[];
  calculatedBmi: number | null;
};

function normalizedVitalNumber(
  normalized: Record<string, unknown>,
  field: (typeof vitalNumberFields)[number],
): number | null | "invalid" {
  const value = normalized[field];
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return "invalid";
  return value;
}

function validClinicalTimestamp(value: string) {
  const validDatePart = (datePart: string) => {
    const [year, month, day] = datePart.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return validDatePart(value);
  return validDatePart(value.slice(0, 10))
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

export function vitalImportValidation(
  candidate: ClinicalDocumentImportCandidate,
  sourceCountry: string,
  importId: string,
): VitalImportValidation {
  const issues: VitalImportValidationIssue[] = [];
  if (candidate.target !== "vital") {
    return { payload: null, issues: ["missing_measurement"], calculatedBmi: null };
  }

  const measuredAt = typeof candidate.normalized.measured_at === "string"
    ? candidate.normalized.measured_at.trim()
    : "";
  if (!measuredAt) issues.push("missing_date");
  else if (!validClinicalTimestamp(measuredAt)) issues.push("invalid_date");
  if (!isCanonicalClinicalImportSourceCountry(sourceCountry)) {
    issues.push("invalid_source_country");
  }
  if (
    candidate.source.page != null
    && (!Number.isInteger(candidate.source.page) || candidate.source.page <= 0)
  ) {
    issues.push("invalid_source_page");
  }

  const values = Object.fromEntries(
    vitalNumberFields.map((field) => [field, normalizedVitalNumber(candidate.normalized, field)]),
  ) as Record<(typeof vitalNumberFields)[number], number | null | "invalid">;
  if (Object.values(values).some((value) => value === "invalid")) issues.push("invalid_number");

  const numbers = Object.fromEntries(
    vitalNumberFields.map((field) => [field, values[field] === "invalid" ? null : values[field]]),
  ) as Record<(typeof vitalNumberFields)[number], number | null>;
  if (Object.values(numbers).every((value) => value == null)) issues.push("missing_measurement");
  if ((numbers.bp_systolic == null) !== (numbers.bp_diastolic == null)) {
    issues.push("incomplete_blood_pressure");
  } else if (
    numbers.bp_systolic != null
    && numbers.bp_diastolic != null
    && numbers.bp_systolic <= numbers.bp_diastolic
  ) {
    issues.push("invalid_blood_pressure");
  }

  for (const field of vitalNumberFields) {
    const value = numbers[field];
    const [minimum, maximum] = vitalRanges[field];
    if (value != null && (value < minimum || value > maximum) && !issues.includes("invalid_number")) {
      issues.push("invalid_number");
    }
  }
  if (
    numbers.heart_rate != null && !Number.isInteger(numbers.heart_rate)
    || numbers.respiratory_rate != null && !Number.isInteger(numbers.respiratory_rate)
    || numbers.oxygen_saturation != null && numbers.oxygen_saturation > 100
  ) {
    if (!issues.includes("invalid_number")) issues.push("invalid_number");
  }

  const calculatedBmi = numbers.weight_kg != null
    && numbers.weight_kg > 0
    && numbers.height_cm != null
    && numbers.height_cm > 0
    ? Math.round((numbers.weight_kg / ((numbers.height_cm / 100) ** 2)) * 10) / 10
    : null;
  if (
    calculatedBmi != null
    && numbers.bmi != null
    && Math.abs(calculatedBmi - numbers.bmi) > 0.5
  ) {
    issues.push("bmi_conflict");
  }

  if (issues.length > 0) return { payload: null, issues, calculatedBmi };

  return {
    payload: {
      measured_at: measuredAt,
      bp_systolic: numbers.bp_systolic,
      bp_diastolic: numbers.bp_diastolic,
      heart_rate: numbers.heart_rate,
      temperature_c: numbers.temperature_c,
      oxygen_saturation: numbers.oxygen_saturation,
      respiratory_rate: numbers.respiratory_rate,
      weight_kg: numbers.weight_kg,
      height_cm: numbers.height_cm,
      bmi: numbers.bmi ?? calculatedBmi,
      notes: candidate.value.trim() || candidate.source.text.trim() || null,
      source_country: sourceCountry,
      source_import_id: importId,
      source_candidate_id: candidate.id,
      source_page: candidate.source.page,
    },
    issues: [],
    calculatedBmi,
  };
}

export function vitalImportPayload(
  candidate: ClinicalDocumentImportCandidate,
  sourceCountry: string,
  importId: string,
): ImportedVitalPayload | null {
  return vitalImportValidation(candidate, sourceCountry, importId).payload;
}

export function buildClinicalDocumentCandidatePayloads(
  candidates: ClinicalDocumentImportCandidate[],
  sourceCountry: string,
  importId: string,
): {
  candidatePayloads: ClinicalDocumentCandidatePayloads;
  invalidCandidate: ClinicalDocumentImportCandidate | null;
} {
  const candidatePayloads: ClinicalDocumentCandidatePayloads = {};
  for (const candidate of candidates) {
    if (!candidate.selected) continue;
    if (candidate.target === "medication") {
      const payload = medicationImportPayload(candidate, sourceCountry);
      if (!payload) return { candidatePayloads, invalidCandidate: candidate };
      candidatePayloads[candidate.id] = payload;
    } else if (candidate.target === "lab_result") {
      const payload = labResultImportPayload(candidate, sourceCountry, importId);
      if (!payload) return { candidatePayloads, invalidCandidate: candidate };
      candidatePayloads[candidate.id] = payload;
    } else if (candidate.target === "vital") {
      const payload = vitalImportPayload(candidate, sourceCountry, importId);
      if (!payload) return { candidatePayloads, invalidCandidate: candidate };
      candidatePayloads[candidate.id] = payload;
    }
  }
  return { candidatePayloads, invalidCandidate: null };
}
