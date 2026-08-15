import { describe, expect, it } from "vitest";

import type { ClinicalDocumentImportCandidate } from "./clinical-document-import";
import {
  buildClinicalDocumentCandidatePayloads,
  deriveClinicalImportSourceCountry,
  labResultImportPayload,
  vitalImportValidation,
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
        laboratory_name: " SYNLAB Berlin ",
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
      laboratory_name: "SYNLAB Berlin",
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

  it("freezes a complete vital payload with canonical values and provenance", () => {
    const vital = candidate("vital-1", "vital", {
      measured_at: "2026-08-10T09:30:00+02:00",
      bp_systolic: 128,
      bp_diastolic: 82,
      heart_rate: 71,
      temperature_c: 36.7,
      oxygen_saturation: 98,
      respiratory_rate: 15,
      weight_kg: 72.4,
      height_cm: 175,
      bmi: 23.6,
    });
    vital.value = "RR 128/82, Puls 71, Temp 36,7 °C, SpO2 98 %, 72,4 kg, 175 cm";
    vital.source.page = 3;

    const result = buildClinicalDocumentCandidatePayloads([vital], "DE", "import-1");

    expect(result.invalidCandidate).toBeNull();
    expect(result.candidatePayloads["vital-1"]).toEqual({
      measured_at: "2026-08-10T09:30:00+02:00",
      bp_systolic: 128,
      bp_diastolic: 82,
      heart_rate: 71,
      temperature_c: 36.7,
      oxygen_saturation: 98,
      respiratory_rate: 15,
      weight_kg: 72.4,
      height_cm: 175,
      bmi: 23.6,
      notes: vital.value,
      source_country: "DE",
      source_import_id: "import-1",
      source_candidate_id: "vital-1",
      source_page: 3,
    });
  });

  it("blocks a selected vital with an incomplete BP pair or inconsistent BMI", () => {
    const vital = candidate("vital-1", "vital", {
      measured_at: "2026-08-10",
      bp_systolic: 128,
      weight_kg: 72,
      height_cm: 180,
      bmi: 30,
    });

    const validation = vitalImportValidation(vital, "DE", "import-1");
    const result = buildClinicalDocumentCandidatePayloads([vital], "DE", "import-1");

    expect(validation.payload).toBeNull();
    expect(validation.issues).toEqual(expect.arrayContaining([
      "incomplete_blood_pressure",
      "bmi_conflict",
    ]));
    expect(result.invalidCandidate?.id).toBe("vital-1");
    expect(result.candidatePayloads).toEqual({});
  });

  it("rejects out-of-range vital values and a non-canonical source country", () => {
    const vital = candidate("vital-1", "vital", {
      measured_at: "2026-02-30",
      oxygen_saturation: 101,
    });

    const validation = vitalImportValidation(vital, "Germany", "import-1");

    expect(validation.payload).toBeNull();
    expect(validation.issues).toEqual(expect.arrayContaining([
      "invalid_date",
      "invalid_number",
      "invalid_source_country",
    ]));
  });

  it("accepts date-only precision but rejects an OCR datetime without an explicit timezone", () => {
    const dateOnly = candidate("vital-date", "vital", {
      measured_at: "2026-08-10",
      heart_rate: 72,
    });
    const naiveDateTime = candidate("vital-naive", "vital", {
      measured_at: "2026-08-10T09:30:00",
      heart_rate: 72,
    });

    expect(vitalImportValidation(dateOnly, "DE", "import-1").payload?.measured_at)
      .toBe("2026-08-10");
    expect(vitalImportValidation(naiveDateTime, "DE", "import-1")).toMatchObject({
      payload: null,
      issues: ["invalid_date"],
    });
  });

  it("also rejects a laboratory OCR datetime without an explicit timezone", () => {
    const dateOnly = candidate("lab-date", "lab_result", {
      analyte_name: "Leukozyten",
      result_text: "7.2",
      measured_on: "2026-08-10",
    });
    const naiveDateTime = candidate("lab-naive", "lab_result", {
      analyte_name: "Leukozyten",
      result_text: "7.2",
      measured_on: "2026-08-10T09:30:00",
    });

    expect(labResultImportPayload(dateOnly, "DE", "import-1")?.measured_at)
      .toBe("2026-08-10");
    expect(labResultImportPayload(naiveDateTime, "DE", "import-1")).toBeNull();
  });
});
