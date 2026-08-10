import { describe, expect, it } from "vitest";

import type { ClinicalDocumentImportCandidate } from "./clinical-document-import";
import {
  buildClinicalDocumentCandidatePayloads,
  deriveClinicalImportSourceCountry,
} from "./clinical-document-import-payloads";

function candidate(
  id: string,
  target: ClinicalDocumentImportCandidate["target"],
  normalized: Record<string, unknown>,
): ClinicalDocumentImportCandidate {
  return {
    id,
    target,
    normalized,
    value: id,
    confidence: 0.9,
    selected: true,
    source: { page: 1, section: target, text: id },
  };
}

describe("canonical clinical document candidate payloads", () => {
  it("derives a unique exact source country but requires confirmation for conflicts", () => {
    expect(
      deriveClinicalImportSourceCountry([
        candidate("med-1", "medication", { source_country: "UA" }),
        candidate("lab-1", "lab_result", { source_country: "UA" }),
      ]),
    ).toBe("UA");
    expect(
      deriveClinicalImportSourceCountry([
        candidate("med-1", "medication", { source_country: "UA" }),
        candidate("lab-1", "lab_result", { source_country: "DE" }),
      ]),
    ).toBe("");
    expect(
      deriveClinicalImportSourceCountry([
        candidate("med-1", "medication", { source_country: "Ukraine" }),
      ]),
    ).toBe("");
    expect(
      deriveClinicalImportSourceCountry([
        candidate("med-1", "medication", { source_country: "UA" }),
        candidate("lab-1", "lab_result", { source_country: "Germany" }),
      ]),
    ).toBe("");
  });

  it("freezes the exact medication and lab payloads under their candidate ids", () => {
    const candidates = [
      candidate("med-1", "medication", {
        wirkstoff: "Metoprolol",
        source_country: "DE",
      }),
      candidate("lab-1", "lab_result", {
        analyte_name: "Leukozyten",
        result_text: "7.2",
        measured_on: "2026-08-10",
        unit: "G/L",
        source_country: "DE",
      }),
    ];

    const result = buildClinicalDocumentCandidatePayloads(candidates, "UA", "import-1");

    expect(result.invalidCandidate).toBeNull();
    expect(result.candidatePayloads["med-1"]).toMatchObject({
      candidate_id: "med-1",
      source_country: "UA",
    });
    expect(result.candidatePayloads["lab-1"]).toEqual({
      measured_at: "2026-08-10",
      panel: null,
      analyte_name: "Leukozyten",
      result_text: "7.2",
      numeric_result: null,
      comparator: null,
      unit: "G/L",
      reference_text: null,
      reference_low: null,
      reference_high: null,
      abnormal_flag: "unknown",
      source_country: "UA",
      source_import_id: "import-1",
      source_candidate_id: "lab-1",
      source_page: 1,
    });
  });
});
