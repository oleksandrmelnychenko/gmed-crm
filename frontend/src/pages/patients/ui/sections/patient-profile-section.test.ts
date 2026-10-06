import { describe, expect, it } from "vitest";

import type { DocumentItem } from "../../model/detail-tab-types";
import { isPatientIdentityDocument } from "./patient-profile-section";

/** A document as the patient card reads it; only the markers matter here. */
function document(art: string, category: string | null = "identity", complianceKind: string | null = null): DocumentItem {
  return { id: `doc-${art}`, art, category, compliance_kind: complianceKind } as unknown as DocumentItem;
}

describe("the patient's identity document on the patient card", () => {
  it("is the patient's own passport or identity document", () => {
    expect(isPatientIdentityDocument(document("identity"))).toBe(true);
    expect(isPatientIdentityDocument(document("Reisepass", "personal_passport"))).toBe(true);
    expect(isPatientIdentityDocument(document("passport_scan", null))).toBe(true);
    expect(isPatientIdentityDocument(document("Befund", "medical_report", "identity"))).toBe(true);
    expect(isPatientIdentityDocument(document("Befund", "medical_report"))).toBe(false);
  });

  it("is never another person's file, although it is filed as identity", () => {
    // The payer's uploads on the payer link and a representative's uploads in the lead cabinet.
    for (const art of ["payer_identity", "payer_funds_proof", "representative_identity", "representative_authority"]) {
      expect(isPatientIdentityDocument(document(art)), art).toBe(false);
      expect(isPatientIdentityDocument(document(` ${art.toUpperCase()} `, "identity", "identity")), art).toBe(false);
    }
  });
});
