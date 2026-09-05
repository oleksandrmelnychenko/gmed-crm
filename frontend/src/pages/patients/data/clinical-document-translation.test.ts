import { describe, expect, it } from "vitest";
import type { ClinicalDocumentImportCandidate, ClinicalDocumentTranslation } from "./clinical-document-import";
import { applyGermanCandidateDraft, germanCandidateDraft, germanTranslationPage } from "./clinical-document-translation";

const candidate: ClinicalDocumentImportCandidate = {
  id: "one", target: "diagnosis", value: "Suspected pneumonia", selected: true, confidence: 0.7,
  normalized: { label: "Suspected pneumonia", assertion: "suspected", certainty: "verdacht" },
  source: { page: 2, section: "Diagnosis", text: "Suspected pneumonia" },
};
const translation: ClinicalDocumentTranslation = {
  status: "review_required", source_language: "en", target_language: "de", provider: "local_argos", model: "argos-en_de-1.3",
  text: "\fVerdacht auf Pneumonie", candidate_values: { one: "Verdacht auf Pneumonie" }, warnings: [],
};

describe("clinical German translation review", () => {
  it("adopts wording without confirming a suspected diagnosis or replacing source evidence", () => {
    const result = applyGermanCandidateDraft(candidate, translation);
    expect(result.value).toBe("Verdacht auf Pneumonie");
    expect(result.selected).toBe(false);
    expect(result.source).toEqual(candidate.source);
    expect(result.normalized).toMatchObject({ label: "Verdacht auf Pneumonie", assertion: "suspected", certainty: "verdacht", auto_select: false });
    expect(candidate.value).toBe("Suspected pneumonia");
  });
  it.each(["medication", "lab_result", "vital"] as const)("does not overwrite structured %s fields", (target) => {
    const item = { ...candidate, target, normalized: { staerke: "500 mg" } };
    expect(applyGermanCandidateDraft(item, translation)).toBe(item);
  });
  it("offers no adoption when the model failed or number validation excluded the candidate", () => {
    expect(germanCandidateDraft(candidate, { ...translation, status: "failed" })).toBeNull();
    expect(applyGermanCandidateDraft(candidate, { ...translation, candidate_values: {} })).toBe(candidate);
  });
  it("retains empty leading pages and does not label another page's text as this page", () => {
    expect(germanTranslationPage(translation, 1)).toBe("");
    expect(germanTranslationPage(translation, 2)).toBe("Verdacht auf Pneumonie");
    expect(germanTranslationPage(translation, 3)).toBe("");
  });
});
