import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "@/lib/api";
import {
  completeClinicalDocumentImport,
  clinicalImportNeedsSourceCountry,
  createClinicalDocumentImport,
  deleteClinicalDocumentImport,
  fetchClinicalDocumentImport,
  fetchClinicalDocumentImports,
  fetchPatientMedicationImportHistory,
  persistClinicalDocumentMedication,
  prepareClinicalDocumentImport,
  retryClinicalDocumentImport,
  type ClinicalDocumentImportDraft,
} from "./clinical-document-import";

describe("clinical document import API", () => {
  beforeEach(() => vi.mocked(apiFetch).mockReset());

  it("creates and polls a patient-scoped import", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ id: "import-1" });

    await createClinicalDocumentImport("patient-1", "document-1");
    await fetchClinicalDocumentImports("patient-1");
    await fetchClinicalDocumentImport("patient-1", "import-1");
    await retryClinicalDocumentImport("patient-1", "import-1");

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

  it("requires source country for role-independent mixed diagnosis, lab, or medication imports", () => {
    expect(clinicalImportNeedsSourceCountry([{ target: "anamnesis" }, { target: "medication" }])).toBe(true);
    expect(clinicalImportNeedsSourceCountry([{ target: "recommendation" }, { target: "lab_result" }])).toBe(true);
    expect(clinicalImportNeedsSourceCountry([{ target: "examination" }, { target: "diagnosis" }])).toBe(true);
    expect(clinicalImportNeedsSourceCountry([{ target: "anamnesis" }, { target: "recommendation" }])).toBe(false);
  });

  it("freezes the exact reviewed draft and country before applying writes", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      id: "import-1",
      status: "applying",
      idempotent: false,
      source_country: "DE",
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
    );

    expect(apiFetch).toHaveBeenCalledWith(
      "/patients/patient-1/clinical-document-imports/import-1/prepare",
      {
        method: "POST",
        body: JSON.stringify({
          reviewed_draft: draft,
          candidate_payloads: candidatePayloads,
          source_country: "DE",
        }),
      },
    );
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
