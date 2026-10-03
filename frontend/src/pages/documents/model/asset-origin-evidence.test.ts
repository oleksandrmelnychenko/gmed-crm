import { describe, expect, it } from "vitest";

import {
  assetOriginEvidenceUploadForm,
  parseAssetOriginEvidence,
  serializeAssetOriginEvidence,
} from "./asset-origin-evidence";

describe("parseAssetOriginEvidence", () => {
  it("reads the stored list from an array or its JSON text and drops anything else", () => {
    const items = [{ documentId: "a", filename: "Kontoauszug.pdf" }];
    expect(parseAssetOriginEvidence(items)).toEqual(items);
    expect(parseAssetOriginEvidence(serializeAssetOriginEvidence(items))).toEqual(items);
    expect(
      parseAssetOriginEvidence([
        { documentId: "a", filename: "Kontoauszug.pdf", uploadedOn: "2026-10-03" },
        { documentId: "a", filename: "doppelt.pdf" },
        { documentId: " " },
        { filename: "ohne-id.pdf" },
        null,
      ]),
    ).toEqual(items);
    expect(parseAssetOriginEvidence("not json")).toEqual([]);
    expect(parseAssetOriginEvidence(undefined)).toEqual([]);
    expect(serializeAssetOriginEvidence([])).toBe("");
  });
});

describe("assetOriginEvidenceUploadForm", () => {
  const file = new File(["%PDF-1.4"], "Kontoauszug.pdf", { type: "application/pdf" });

  it("files a proof as an internal AML document of the patient, else of the lead", () => {
    const forPatient = assetOriginEvidenceUploadForm(file, { patientId: "patient-1", leadId: "lead-1" });
    expect(forPatient?.get("patient_id")).toBe("patient-1");
    expect(forPatient?.get("lead_id")).toBeNull();
    expect(forPatient?.get("art")).toBe("aml_asset_origin_evidence");
    expect(forPatient?.get("category")).toBe("compliance_aml");
    expect(forPatient?.get("visibility")).toBe("internal");
    expect(forPatient?.get("auto_name")).toBe("Herkunftsnachweis (GwG) · Kontoauszug.pdf");
    expect((forPatient?.get("file") as File).name).toBe("Kontoauszug.pdf");

    const forLead = assetOriginEvidenceUploadForm(file, { leadId: " lead-1 " });
    expect(forLead?.get("lead_id")).toBe("lead-1");
    expect(forLead?.get("patient_id")).toBeNull();
  });

  it("has nothing to file a proof under without a patient or lead", () => {
    expect(assetOriginEvidenceUploadForm(file, {})).toBeNull();
    expect(assetOriginEvidenceUploadForm(file, { patientId: " ", leadId: null })).toBeNull();
  });
});
