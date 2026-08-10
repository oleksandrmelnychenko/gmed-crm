import { COUNTRY_CODES } from "@/components/ui/country-select";

import type {
  ClinicalDocumentCandidatePayloads,
  ClinicalDocumentImportCandidate,
  ImportedLabResultPayload,
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
  if (!analyteName || !resultText || !measuredAt) return null;

  return {
    measured_at: measuredAt,
    panel: typeof normalized.panel === "string" ? normalized.panel : null,
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
    }
  }
  return { candidatePayloads, invalidCandidate: null };
}
