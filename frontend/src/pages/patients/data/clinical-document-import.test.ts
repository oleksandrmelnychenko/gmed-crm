import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "@/lib/api";
import {
  completeClinicalDocumentImport,
  createClinicalDocumentImport,
  deleteClinicalDocumentImport,
  fetchClinicalDocumentImport,
  fetchClinicalDocumentImports,
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
