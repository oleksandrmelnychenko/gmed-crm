import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";
import { de } from "@/lib/i18n/de";
import { ru } from "@/lib/i18n/ru";

import {
  buildConsentFormPatchAfterSuccess,
  canExportPatientData,
  privacyRequestErrorMessage,
  privacySourceUiKey,
  resolveActivePatientLabel,
} from "./admin-compliance.helpers";

const refused = (status: number, message: string, error = "Conflict") =>
  new ApiRequestError(message, { status, code: error, body: { error, message } });

describe("DSGVO register refusals in the UI language", () => {
  it("translates the execution refusals", () => {
    expect(
      privacyRequestErrorMessage(refused(409, "Privacy request must be approved before execution"), ru),
    ).toBe("Запрос нужно сначала одобрить, затем исполнить.");
    expect(
      privacyRequestErrorMessage(
        refused(409, "Verify and record the requester's identity before executing this request"),
        de,
      ),
    ).toContain("Identität");
    expect(
      privacyRequestErrorMessage(
        refused(403, "Only CEO or IT admin can execute this privacy request type", "Forbidden"),
        ru,
      ),
    ).toBe("Удаление и ограничение обработки исполняют только CEO или IT-администратор.");
    expect(privacyRequestErrorMessage(refused(409, "Privacy request was already executed"), de)).toBe(
      "Der Antrag wurde bereits ausgeführt.",
    );
  });

  it("falls back by status, never to the raw English text", () => {
    expect(privacyRequestErrorMessage(refused(403, "Insufficient permissions", "Forbidden"), ru)).toBe(
      ru.uiText.compliance_error_forbidden,
    );
    expect(
      privacyRequestErrorMessage(refused(500, "Failed to finalize privacy request", "Internal Server Error"), de),
    ).toBe(de.uiText.compliance_error_failed);
  });

  it("keeps a refusal apiFetch has translated already", () => {
    const coded = new ApiRequestError("Срок хранения ещё не истёк.", {
      status: 409,
      code: "erasure_blocked_by_retention",
      body: { error: "erasure_blocked_by_retention" },
    });
    expect(privacyRequestErrorMessage(coded, ru)).toBe("Срок хранения ещё не истёк.");
  });
});

describe("admin compliance helpers", () => {
  it("offers the Art. 15 export only to the roles the server lets export (QA E2-08)", () => {
    expect(canExportPatientData("ceo")).toBe(true);
    expect(canExportPatientData("patient_manager")).toBe(true);
    expect(canExportPatientData("it_admin")).toBe(false);
    expect(canExportPatientData(undefined)).toBe(false);
  });

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
