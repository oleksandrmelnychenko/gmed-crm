import type { ClinicalDocumentImportCandidate, ClinicalDocumentTranslation } from "./clinical-document-import";

export function germanCandidateDraft(
  candidate: ClinicalDocumentImportCandidate,
  translation: ClinicalDocumentTranslation | null | undefined,
): string | null {
  if (translation?.status !== "review_required") return null;
  return translation.candidate_values[candidate.id]?.trim() || null;
}

export function applyGermanCandidateDraft(
  candidate: ClinicalDocumentImportCandidate,
  translation: ClinicalDocumentTranslation | null | undefined,
): ClinicalDocumentImportCandidate {
  const value = germanCandidateDraft(candidate, translation);
  if (!value || !["diagnosis", "anamnesis", "examination", "recommendation"].includes(candidate.target)) {
    return candidate;
  }
  // Wording is editable, but adopting a machine draft is not confirmation of
  // the fact. Keep the original evidence and the existing semantic assertion.
  const fields: Partial<Record<ClinicalDocumentImportCandidate["target"], string>> = {
    diagnosis: "label", anamnesis: "anamnese_aktuelle", examination: "result", recommendation: "description",
  };
  const field = fields[candidate.target];
  if (!field) return candidate;
  return {
    ...candidate,
    value,
    selected: false,
    normalized: { ...candidate.normalized, [field]: value, auto_select: false },
  };
}

export function germanTranslationPage(translation: ClinicalDocumentTranslation, pageNumber: number): string {
  if (translation.status !== "review_required" || !translation.text) return "";
  return translation.text.includes("\f") ? (translation.text.split("\f")[pageNumber - 1] ?? "") : translation.text;
}
