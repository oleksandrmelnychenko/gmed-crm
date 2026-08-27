import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PatientLabResult } from "@/pages/patients/model/detail-resource-types";
import {
  PatientLabCorrectionMetadata,
  PatientLabResultDeleteAction,
  PatientLabResultEditAction,
  buildPatientLabCorrectionPayload,
  patientLabCorrectionFormFromResult,
  synchronizePatientLabResultText,
} from "./patient-lab-result-edit-sheet";

function labResult(overrides: Partial<PatientLabResult> = {}): PatientLabResult {
  return {
    id: "lab-1",
    measured_at: "2026-08-10T00:00:00Z",
    measured_at_precision: "date",
    panel: "Blutbild",
    laboratory_name: "SYNLAB Berlin",
    analyte_name: "Hämoglobin",
    result_text: "134",
    numeric_result: 134,
    comparator: null,
    unit: "g/L",
    reference_text: "120–160",
    reference_low: 120,
    reference_high: 160,
    interpretation_note: "Risk band: low",
    abnormal_flag: "normal",
    source_document_id: "document-1",
    source_document_name: "labor.pdf",
    source_import_id: "import-1",
    source_candidate_id: "candidate-1",
    source_page: 2,
    recorded_by_name: "Dr. Original",
    created_at: "2026-08-10T00:00:00Z",
    ...overrides,
  };
}

describe("lab result correction form", () => {
  it("preserves date-only precision and builds a provenance-free full payload", () => {
    const form = patientLabCorrectionFormFromResult(labResult());
    expect(form.measuredAt).toBe("2026-08-10");
    expect(form.measuredAtPrecision).toBe("date");

    const result = buildPatientLabCorrectionPayload({
      ...form,
      analyteName: " Hämoglobin ",
      resultText: " 13,4 ",
      numericResult: "13,4",
      referenceLow: "12,0",
      referenceHigh: "16,0",
      correctionNote: " OCR decimal corrected ",
    });

    expect(result).toEqual({
      ok: true,
      payload: {
        measured_at: "2026-08-10",
        panel: "Blutbild",
        laboratory_name: "SYNLAB Berlin",
        analyte_name: "Hämoglobin",
        result_text: "13,4",
        numeric_result: 13.4,
        comparator: null,
        unit: "g/L",
        reference_text: "120–160",
        reference_low: 12,
        reference_high: 16,
        interpretation_note: "Risk band: low",
        abnormal_flag: "normal",
        correction_note: "OCR decimal corrected",
      },
    });
    if (result.ok) {
      expect(result.payload).not.toHaveProperty("source_document_id");
      expect(result.payload).not.toHaveProperty("source_import_id");
      expect(result.payload).not.toHaveProperty("measured_at_precision");
    }
  });

  it("requires a correction reason and rejects an inverted reference range", () => {
    const form = patientLabCorrectionFormFromResult(labResult());
    expect(buildPatientLabCorrectionPayload(form)).toEqual({
      ok: false,
      error: "correction_note",
    });
    expect(buildPatientLabCorrectionPayload({
      ...form,
      correctionNote: "Manual review",
      referenceLow: "20",
      referenceHigh: "10",
    })).toEqual({
      ok: false,
      error: "reference_range",
    });
  });

  it("counts the correction reason limit in Unicode characters", () => {
    const form = patientLabCorrectionFormFromResult(labResult());
    expect(buildPatientLabCorrectionPayload({
      ...form,
      correctionNote: "🙂".repeat(500),
    }).ok).toBe(true);
    expect(buildPatientLabCorrectionPayload({
      ...form,
      correctionNote: "🙂".repeat(501),
    })).toEqual({
      ok: false,
      error: "correction_note",
    });
  });

  it("round-trips datetime seconds and milliseconds without truncation", () => {
    const original = "2026-08-10T09:30:45.123Z";
    const form = patientLabCorrectionFormFromResult(labResult({
      measured_at: original,
      measured_at_precision: "datetime",
    }));
    expect(form.measuredAt).toMatch(/T\d{2}:\d{2}:45\.123$/);

    const built = buildPatientLabCorrectionPayload({
      ...form,
      correctionNote: "Confirmed timestamp",
    });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.payload.measured_at).toBe(original);
  });

  it("synchronizes OCR numeric value, comparator and stale flag from edited display text", () => {
    const form = patientLabCorrectionFormFromResult(labResult({
      result_text: "134",
      numeric_result: 134,
      reference_low: 12,
      reference_high: 16,
      abnormal_flag: "high",
    }));
    const corrected = synchronizePatientLabResultText(form, "13.4");
    expect(corrected).toMatchObject({
      resultText: "13.4",
      numericResult: "13.4",
      comparator: "",
      abnormalFlag: "normal",
    });
    const built = buildPatientLabCorrectionPayload({
      ...corrected,
      correctionNote: "OCR decimal corrected",
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload.numeric_result).toBe(13.4);
      expect(built.payload.abnormal_flag).toBe("normal");
    }
  });

  it("preserves locale-grouped OCR values using the stored numeric projection", () => {
    for (const resultText of ["14.000", "14 000", "14\u00a0000", "14\u202f000"]) {
      const form = patientLabCorrectionFormFromResult(labResult({
        result_text: resultText,
        numeric_result: 14_000,
        unit: "/μL",
        reference_low: 4_000,
        reference_high: 10_000,
        abnormal_flag: "high",
      }));
      expect(synchronizePatientLabResultText(form, resultText)).toMatchObject({
        numericResult: "14000",
        abnormalFlag: "high",
      });
      const built = buildPatientLabCorrectionPayload({
        ...form,
        correctionNote: "Verified grouped OCR value",
      });
      expect(built.ok, resultText).toBe(true);
      if (built.ok) expect(built.payload.numeric_result).toBe(14_000);
    }

    const mixed = synchronizePatientLabResultText(
      patientLabCorrectionFormFromResult(labResult({
        numeric_result: 1234.5,
        reference_low: null,
        reference_high: null,
      })),
      "1.234,5 mg/L",
    );
    expect(mixed).toMatchObject({
      numericResult: "1234.5",
      unit: "g/L",
      abnormalFlag: "normal",
    });
  });

  it("canonicalizes Unicode comparators for an existing row without losing its projection", () => {
    const form = patientLabCorrectionFormFromResult(labResult({
      result_text: "≤ 5,0 mg/L",
      numeric_result: 5,
      comparator: "<=",
      unit: "mg/L",
      reference_low: 12,
      reference_high: 16,
      abnormal_flag: "low",
    }));
    const built = buildPatientLabCorrectionPayload({
      ...form,
      correctionNote: "Unicode comparator verified",
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.payload.result_text).toBe("<= 5,0 mg/L");
      expect(built.payload.numeric_result).toBe(5);
      expect(built.payload.comparator).toBe("<=");
    }
  });

  it("clears stale numeric structure for a qualitative display and blocks contradictions", () => {
    const form = patientLabCorrectionFormFromResult(labResult());
    expect(synchronizePatientLabResultText(form, "negative")).toMatchObject({
      resultText: "negative",
      numericResult: "",
      comparator: "",
      abnormalFlag: "normal",
    });
    expect(buildPatientLabCorrectionPayload({
      ...form,
      resultText: "13.4",
      numericResult: "134",
      referenceLow: "12",
      referenceHigh: "16",
      abnormalFlag: "high",
      correctionNote: "OCR decimal corrected",
    })).toEqual({ ok: false, error: "result_numeric_mismatch" });
    expect(buildPatientLabCorrectionPayload({
      ...form,
      resultText: "13.4",
      numericResult: "13.4",
      referenceLow: "12",
      referenceHigh: "16",
      abnormalFlag: "high",
      correctionNote: "OCR decimal corrected",
    })).toEqual({ ok: false, error: "abnormal_flag_conflict" });
  });

  it("accepts equivalent comparator and unit formatting but rejects stale comparator", () => {
    const form = patientLabCorrectionFormFromResult(labResult({
      result_text: "13.4 g / dL",
      numeric_result: 13.4,
      comparator: "=",
      unit: "G/DL",
      reference_low: 12,
      reference_high: 16,
    }));
    expect(buildPatientLabCorrectionPayload({
      ...form,
      correctionNote: "Formatting verified",
    }).ok).toBe(true);
    expect(buildPatientLabCorrectionPayload({
      ...form,
      resultText: "<13.4 g/dL",
      correctionNote: "Comparator checked",
    })).toEqual({ ok: false, error: "result_comparator_mismatch" });
  });

  it("keeps semiquantitative, ratio and range results textual without inventing units", () => {
    for (const resultText of ["2+", "1:80", "0-1"]) {
      const form = patientLabCorrectionFormFromResult(labResult({
        result_text: "2",
        numeric_result: 2,
        comparator: "=",
        unit: "score",
        reference_low: null,
        reference_high: null,
        abnormal_flag: "abnormal",
      }));
      const synchronized = synchronizePatientLabResultText(form, resultText);
      expect(synchronized, resultText).toMatchObject({
        resultText,
        numericResult: "",
        comparator: "",
        unit: "score",
        abnormalFlag: "abnormal",
      });
      expect(buildPatientLabCorrectionPayload({
        ...synchronized,
        correctionNote: "Qualitative value verified",
      }).ok, resultText).toBe(true);
    }
  });

  it("treats parenthesized and bracketed lab flags as annotations, not units", () => {
    const form = patientLabCorrectionFormFromResult(labResult({
      result_text: "13.0",
      numeric_result: 13,
      unit: "g/dL",
      reference_low: null,
      reference_high: null,
      abnormal_flag: "normal",
    }));
    for (const resultText of ["13.2 (H)", "13.2 [H]"]) {
      const synchronized = synchronizePatientLabResultText(form, resultText);
      expect(synchronized, resultText).toMatchObject({
        numericResult: "13.2",
        unit: "g/dL",
        abnormalFlag: "high",
      });
      const built = buildPatientLabCorrectionPayload({
        ...synchronized,
        correctionNote: "High flag verified",
      });
      expect(built.ok, resultText).toBe(true);
      if (built.ok) expect(built.payload.unit).toBe("g/dL");
    }
  });

  it("never overwrites the dedicated unit from result text", () => {
    const form = patientLabCorrectionFormFromResult(labResult({
      result_text: "13.0",
      numeric_result: 13,
      unit: "g/L",
      reference_low: null,
      reference_high: null,
    }));
    const synchronized = synchronizePatientLabResultText(form, "13.2 mg/dL");
    expect(synchronized.unit).toBe("g/L");
    expect(buildPatientLabCorrectionPayload({
      ...synchronized,
      correctionNote: "Unit checked",
    })).toEqual({ ok: false, error: "result_unit_mismatch" });
    expect(buildPatientLabCorrectionPayload({
      ...synchronized,
      unit: "mg/dL",
      correctionNote: "Unit checked",
    }).ok).toBe(true);
  });

  it("preserves an existing abnormal flag when no definite derivation is possible", () => {
    const qualitative = patientLabCorrectionFormFromResult(labResult({
      result_text: "positve",
      numeric_result: null,
      comparator: null,
      reference_low: null,
      reference_high: null,
      abnormal_flag: "abnormal",
    }));
    expect(synchronizePatientLabResultText(qualitative, "positive").abnormalFlag).toBe("abnormal");

    const numeric = patientLabCorrectionFormFromResult(labResult({
      result_text: "13.0",
      numeric_result: 13,
      reference_low: null,
      reference_high: null,
      abnormal_flag: "high",
    }));
    expect(synchronizePatientLabResultText(numeric, "13.2").abnormalFlag).toBe("high");

    const inequality = patientLabCorrectionFormFromResult(labResult({
      result_text: "< 13.0",
      numeric_result: 13,
      comparator: "<",
      reference_low: 12,
      reference_high: 16,
      abnormal_flag: "abnormal",
    }));
    expect(synchronizePatientLabResultText(inequality, "< 13.2").abnormalFlag).toBe("abnormal");
  });
});

describe("lab history correction affordances", () => {
  it("renders an accessible icon-only edit action for a history row", () => {
    const html = renderToStaticMarkup(
      <PatientLabResultEditAction label="Исправить" onEdit={vi.fn()} />,
    );
    expect(html).not.toContain(">Исправить<");
    expect(html).toContain('aria-label="Исправить"');
  });

  it("renders an accessible destructive delete action for a history row", () => {
    const html = renderToStaticMarkup(
      <PatientLabResultDeleteAction label="Удалить" onDelete={vi.fn()} />,
    );
    expect(html).not.toContain(">Удалить<");
    expect(html).toContain('aria-label="Удалить"');
    expect(html).toContain("text-destructive");
  });

  it("renders who corrected the row and why", () => {
    const html = renderToStaticMarkup(
      <PatientLabCorrectionMetadata
        item={labResult({
          corrected_at: "2026-08-14T18:00:00Z",
          corrected_by: "user-1",
          corrected_by_name: "Dr. Reviewer",
          correction_note: "OCR read 134 instead of 13.4",
        })}
        tx={(_ru, de) => de}
      />,
    );
    expect(html).toContain("Korrigiert");
    expect(html).toContain("Dr. Reviewer");
    expect(html).toContain("OCR read 134 instead of 13.4");
  });
});
