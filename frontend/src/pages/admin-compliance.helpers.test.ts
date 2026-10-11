import { describe, expect, it } from "vitest";

import {
  buildConsentFormPatchAfterSuccess,
  privacySourceUiKey,
  resolveActivePatientLabel,
} from "./admin-compliance.helpers";

describe("admin compliance helpers", () => {
  it("keeps the expiry date after granting consent", () => {
    expect(buildConsentFormPatchAfterSuccess("grant")).toEqual({
      consentNote: "",
    });
  });

  it("clears the expiry date after revoking consent", () => {
    expect(buildConsentFormPatchAfterSuccess("revoke")).toEqual({
      consentExpiresAt: "",
      consentNote: "",
    });
  });

  it("tells a request staff recorded apart from one filed in the portal", () => {
    expect(privacySourceUiKey("patient_request", "patient_self_service")).toBe(
      "privacy_source_patient_request_portal",
    );
    expect(privacySourceUiKey("patient_request", "admin_compliance_workspace")).toBe(
      "privacy_source_patient_request_staff",
    );
    expect(privacySourceUiKey("admin_intake", "retention_sweep")).toBe(
      "privacy_source_retention_sweep",
    );
    expect(privacySourceUiKey("admin_intake", "legacy_anonymize_endpoint")).toBe(
      "privacy_source_direct_erasure",
    );
    expect(privacySourceUiKey("admin_intake", "admin_compliance_workspace")).toBeNull();
  });

  it("names the loaded patient instead of showing the record id", () => {
    const patientId = "b12e34ce-0000-4000-8000-000000000001";
    expect(
      resolveActivePatientLabel(
        patientId,
        [{ id: patientId, label: "P-20261011-0001 · Anna Muster" }],
        [],
      ),
    ).toBe("P-20261011-0001 · Anna Muster");
    expect(
      resolveActivePatientLabel(
        patientId,
        [],
        [{ patient_id: patientId, patient_pid: "P-20261011-0001", patient_name: "Anna Muster" }],
      ),
    ).toBe("P-20261011-0001 - Anna Muster");
    expect(
      resolveActivePatientLabel(patientId, [], [], {
        patient_pid: "P-20261011-0001",
        patient_name: "Anna Muster",
      }),
    ).toBe("P-20261011-0001 - Anna Muster");
    expect(resolveActivePatientLabel(patientId, [], [])).toBe("");
    expect(resolveActivePatientLabel("", [], [])).toBe("");
  });
});
