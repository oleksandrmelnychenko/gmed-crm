import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "@/lib/api";
import {
  completeClinicalDocumentImport,
  clinicalDocumentImportAfterPrepare,
  clinicalDocumentPreviewPage,
  clinicalDocumentTextPages,
  clinicalImportNeedsSourceCountry,
  createClinicalDocumentImport,
  deleteClinicalDocumentImport,
  fetchClinicalDocumentImport,
  fetchClinicalDocumentImports,
  fetchPatientMedicationImportHistory,
  persistClinicalDocumentMedication,
  persistClinicalDocumentVital,
  prepareClinicalDocumentImport,
  rescanClinicalDocumentImport,
  retryClinicalDocumentImport,
  type ClinicalDocumentImportDraft,
} from "./clinical-document-import";

describe("clinical document import API", () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it("keeps empty first and second OCR pages addressable", () => {
    const pages = clinicalDocumentTextPages({
      document_type: "laboratory_report",
      source_language: "de",
      parser_version: "rules-test",
      raw_text: "\f\fPage three",
      warnings: [],
      candidates: [],
      extraction: {
        page_count: 3,
        text_chars: 10,
        used_ocr: true,
        pages: [1, 2, 3].map((pageNumber) => ({
          page_number: pageNumber,
          source: "ocr" as const,
          route_reason: "ocr_required",
          native_quality: null,
          native_char_count: 0,
          ocr_confidence: 0.9,
          low_confidence_word_ratio: 0.1,
          ocr_languages: "latin",
          ocr_engine: "paddle",
          orientation_rotation: 0,
          deskew_angle: 0,
          word_count: pageNumber === 3 ? 2 : 0,
        })),
      },
    });

    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
    expect(pages.map((page) => page.text)).toEqual(["", "", "Page three"]);
    expect(pages.every((page) => page.textScope === "page")).toBe(true);
  });

  it("marks legacy multi-page text without delimiters as document-level", () => {
    const pages = clinicalDocumentTextPages({
      document_type: "laboratory_report",
      source_language: "de",
      parser_version: "legacy",
      raw_text: "Legacy full text",
      warnings: [],
      candidates: [],
      extraction: { page_count: 3, text_chars: 16, used_ocr: false, pages: [] },
    });

    expect(pages).toHaveLength(3);
    expect(pages[1]).toMatchObject({
      pageNumber: 2,
      text: "Legacy full text",
      textScope: "document",
    });
  });

  it("keeps the candidate, source selector, and PDF preview on one page", () => {
    expect(clinicalDocumentPreviewPage(3, 1)).toBe(3);
    expect(clinicalDocumentPreviewPage(null, 2)).toBe(2);
    expect(clinicalDocumentPreviewPage(null, null)).toBe(1);
  });

  it("creates and polls a patient-scoped import", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ id: "import-1" });

    await createClinicalDocumentImport("patient-1", "document-1");
    await fetchClinicalDocumentImports("patient-1");
    await fetchClinicalDocumentImport("patient-1", "import-1");
    await retryClinicalDocumentImport("patient-1", "import-1");
    await rescanClinicalDocumentImport("patient-1", "import-1");

    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      "/patients/patient-1/clinical-document-imports",
      { method: "POST", body: JSON.stringify({ document_id: "document-1" }) },
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      "/patients/patient-1/clinical-document-imports",
      { cache: "no-store" },
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      3,
      "/patients/patient-1/clinical-document-imports/import-1",
      { cache: "no-store" },
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      4,
      "/patients/patient-1/clinical-document-imports/import-1/retry",
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      5,
      "/patients/patient-1/clinical-document-imports/import-1/rescan",
      { method: "POST", body: JSON.stringify({}) },
    );
  });

  it("deletes only the requested patient-scoped import", async () => {
    vi.mocked(apiFetch).mockResolvedValue(undefined);

    await deleteClinicalDocumentImport("patient-1", "import-1");

    expect(apiFetch).toHaveBeenCalledWith(
      "/patients/patient-1/clinical-document-imports/import-1",
      { method: "DELETE" },
    );
  });

  it("persists a reviewed medication through the dedicated import endpoint", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      id: "medication-1",
      action: "created",
      source_date: "2026-08-10",
    });

    const result = await persistClinicalDocumentMedication("patient-1", "import-1", {
      candidate_id: "candidate-1",
      wirkstoff: "Metoprolol",
      dose_morgens: "1",
      source_country: "DE",
      source_page: 2,
      source_date: "2026-08-10",
      source_identifiers: { atc: "C07AB02" },
      source_field_confidence: { wirkstoff: 0.95 },
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/patients/patient-1/clinical-document-imports/import-1/medications",
      {
        method: "POST",
        body: JSON.stringify({
          candidate_id: "candidate-1",
          wirkstoff: "Metoprolol",
          dose_morgens: "1",
          source_country: "DE",
          source_page: 2,
          source_date: "2026-08-10",
          source_identifiers: { atc: "C07AB02" },
          source_field_confidence: { wirkstoff: 0.95 },
        }),
      },
    );
    expect(result.source_date).toBe("2026-08-10");
  });

  it("posts the exact frozen vital payload without reconstructing it", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      id: "vital-record-1",
      created_at: "2026-08-10T09:30:00Z",
      ok: true,
      idempotent: false,
    });
    const frozenPayload = {
      measured_at: "2026-08-10",
      bp_systolic: 128,
      bp_diastolic: 82,
      heart_rate: 71,
      temperature_c: 36.7,
      oxygen_saturation: 98,
      respiratory_rate: 15,
      weight_kg: 72.4,
      height_cm: 175,
      bmi: 23.6,
      notes: "RR 128/82",
      source_country: "DE",
      source_import_id: "import-1",
      source_candidate_id: "vital-1",
      source_page: 3,
    };

    await persistClinicalDocumentVital("patient-1", frozenPayload);

    expect(apiFetch).toHaveBeenCalledWith("/patients/patient-1/vitals", {
      method: "POST",
      body: JSON.stringify(frozenPayload),
    });
  });

  it("requires source country for role-independent diagnosis, lab, medication, or vital imports", () => {
    expect(clinicalImportNeedsSourceCountry([{ target: "anamnesis" }, { target: "medication" }])).toBe(true);
    expect(clinicalImportNeedsSourceCountry([{ target: "recommendation" }, { target: "lab_result" }])).toBe(true);
    expect(clinicalImportNeedsSourceCountry([{ target: "examination" }, { target: "diagnosis" }])).toBe(true);
    expect(clinicalImportNeedsSourceCountry([{ target: "vital" }])).toBe(true);
    expect(clinicalImportNeedsSourceCountry([{ target: "anamnesis" }, { target: "recommendation" }])).toBe(false);
  });

  it("freezes the exact reviewed draft and country before applying writes", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      id: "import-1",
      status: "applying",
      idempotent: false,
      source_country: "DE",
      patient_identity_confirmed: true,
    });
    const draft: ClinicalDocumentImportDraft = {
      document_type: "medication_plan",
      source_language: "de",
      parser_version: "0.1.0",
      warnings: [],
      candidates: [],
    };

    const candidatePayloads = {
      "med-1": { candidate_id: "med-1", wirkstoff: "Metoprolol", source_country: "DE" },
    };
    await prepareClinicalDocumentImport(
      "patient-1",
      "import-1",
      draft,
      candidatePayloads,
      "DE",
      true,
    );

    expect(apiFetch).toHaveBeenCalledWith(
      "/patients/patient-1/clinical-document-imports/import-1/prepare",
      {
        method: "POST",
        body: JSON.stringify({
          reviewed_draft: draft,
          candidate_payloads: candidatePayloads,
          source_country: "DE",
          patient_identity_confirmed: true,
        }),
      },
    );
  });

  it("marks every successful prepare snapshot as a modern frozen identity decision", () => {
    const reviewedDraft: ClinicalDocumentImportDraft = {
      document_type: "discharge_summary",
      source_language: "de",
      parser_version: "rules-0.9.3",
      warnings: [],
      candidates: [],
    };
    const current = {
      id: "import-1",
      patient_id: "patient-1",
      document_id: "document-1",
      document_name: "Arztbrief.pdf",
      mime_type: "application/pdf",
      status: "applying" as const,
      document_type: "discharge_summary",
      source_language: "de",
      parser_version: "rules-0.9.3",
      draft: reviewedDraft,
      reviewed_draft: reviewedDraft,
      applied_counts: {},
      error_message: null,
      prepared_source_country: "DE",
      prepared_patient_identity_confirmed: false,
      prepared_identity_gate_version: 0,
      prepared_at: "2026-08-10T10:00:00Z",
      completed_at: null,
      applied_at: null,
      created_at: "2026-08-10T09:00:00Z",
      updated_at: "2026-08-10T10:00:00Z",
    };

    const next = clinicalDocumentImportAfterPrepare(
      current,
      reviewedDraft,
      {
        ok: true,
        id: "import-1",
        status: "applying",
        idempotent: true,
        source_country: "DE",
        patient_identity_confirmed: true,
      },
      "2026-08-10T11:00:00Z",
    );

    expect(next.status).toBe("applying");
    expect(next.prepared_identity_gate_version).toBe(1);
    expect(next.prepared_patient_identity_confirmed).toBe(true);
    expect(next.prepared_at).toBe("2026-08-10T10:00:00Z");
  });

  it("loads medication import history with offset pagination", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 100 });

    await fetchPatientMedicationImportHistory("patient-1", { limit: 50, offset: 100 });

    expect(apiFetch).toHaveBeenCalledWith(
      "/patients/patient-1/medication-import-history?limit=50&offset=100",
      { cache: "no-store" },
    );
  });

  it("submits only the reviewed draft and applied counts", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ id: "import-1", status: "applied" });
    const draft: ClinicalDocumentImportDraft = {
      document_type: "cardiology_report",
      source_language: "de",
      parser_version: "0.1.0",
      warnings: [],
      candidates: [],
    };

    await completeClinicalDocumentImport("patient-1", "import-1", draft, { diagnoses: 2 });

    expect(apiFetch).toHaveBeenCalledWith(
      "/patients/patient-1/clinical-document-imports/import-1/complete",
      {
        method: "POST",
        body: JSON.stringify({
          reviewed_draft: draft,
          applied_counts: { diagnoses: 2 },
        }),
      },
    );
  });
});
