import { describe, expect, it } from "vitest";

import { defaultComplianceKind } from "./mark-compliance-signed-control";

describe("defaultComplianceKind (QA 2026-10-12 B3-10)", () => {
  it("starts a Schweigepflichtentbindung with its own item, not DSGVO", () => {
    expect(defaultComplianceKind({ generated_template_id: "confidentiality_release" })).toBe(
      "confidentiality_release",
    );
    expect(defaultComplianceKind({ art: "confidentiality_release" })).toBe("confidentiality_release");
  });

  it("follows the document's recorded item, then its template, then its type", () => {
    expect(defaultComplianceKind({ compliance_kind: "framework_contract", art: "privacy_consents" })).toBe(
      "framework_contract",
    );
    expect(defaultComplianceKind({ generated_template_id: "consent_data_release_single" })).toBe("dsgvo");
    expect(defaultComplianceKind({ generated_template_id: "cost_coverage_declaration" })).toBe(
      "cost_coverage_declaration",
    );
    expect(defaultComplianceKind({ art: "passport_scan" })).toBe("identity");
    expect(defaultComplianceKind({ art: "uploaded_document" })).toBe("dsgvo");
    expect(defaultComplianceKind(undefined)).toBe("dsgvo");
  });
});
