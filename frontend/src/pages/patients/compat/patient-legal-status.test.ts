import { describe, expect, it } from "vitest";

import {
  getPatientLegalStatusCompletion,
  getPatientLegalStatusSummary,
  isPatientLegalStatusComplete,
  normalizePatientLegalStatus,
  serializePatientLegalStatus,
} from "../model/legal-status";

describe("normalizePatientLegalStatus", () => {
  it("normalizes partial backend payloads into a stable form state", () => {
    expect(
      normalizePatientLegalStatus({
        dsgvo_signed: true,
        confidentiality_release_signed: false,
        identity_verified: true,
        document_pack_complete: true,
        compliance_completed: false,
        contract_status: "sent",
        notes: "Waiting for signature",
      })
    ).toEqual({
      dsgvoSigned: true,
      confidentialityReleaseSigned: false,
      identityVerified: true,
      documentPackComplete: true,
      complianceCompleted: false,
      contractStatus: "sent",
      notes: "Waiting for signature",
    });
  });

  it("maps legacy string values into compliance notes", () => {
    expect(normalizePatientLegalStatus("DSGVO pending")).toMatchObject({
      notes: "DSGVO pending",
      contractStatus: "not_started",
    });
  });
});

describe("serializePatientLegalStatus", () => {
  it("serializes UI state back into the backend shape", () => {
    expect(
      serializePatientLegalStatus({
        dsgvoSigned: true,
        confidentialityReleaseSigned: true,
        identityVerified: false,
        documentPackComplete: false,
        complianceCompleted: false,
        contractStatus: "pending",
        notes: "  Follow up next week  ",
      })
    ).toEqual({
      dsgvo_signed: true,
      confidentiality_release_signed: true,
      identity_verified: false,
      document_pack_complete: false,
      compliance_completed: false,
      contract_status: "pending",
      notes: "Follow up next week",
    });
  });
});

describe("getPatientLegalStatusCompletion", () => {
  it("counts how much of the compliance checklist is already done", () => {
    expect(
      getPatientLegalStatusCompletion({
        dsgvoSigned: true,
        confidentialityReleaseSigned: true,
        identityVerified: false,
        documentPackComplete: false,
        complianceCompleted: false,
        contractStatus: "sent",
        notes: "",
      })
    ).toEqual({
      completed: 2,
      total: 5,
      ratio: 0.4,
    });
  });
});

describe("getPatientLegalStatusSummary", () => {
  const completeStatus = {
    dsgvoSigned: true,
    confidentialityReleaseSigned: true,
    identityVerified: true,
    documentPackComplete: true,
    complianceCompleted: true,
    contractStatus: "signed",
    notes: "",
  };

  it("returns a complete summary only when every checklist item is done", () => {
    expect(isPatientLegalStatusComplete(completeStatus)).toBe(true);
    expect(getPatientLegalStatusSummary(completeStatus)).toBe("Комплаенс завершен");
  });

  it("keeps a partial summary when compliance is done but another item is missing", () => {
    const partialStatus = {
      ...completeStatus,
      confidentialityReleaseSigned: false,
    };

    expect(isPatientLegalStatusComplete(partialStatus)).toBe(false);
    expect(getPatientLegalStatusSummary(partialStatus)).toBe(
      "Выполнено 4 из 5 проверок комплаенса"
    );
  });
});
