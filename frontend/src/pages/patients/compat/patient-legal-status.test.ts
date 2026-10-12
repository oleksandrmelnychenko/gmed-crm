import { describe, expect, it } from "vitest";

import {
  getPatientLegalStatusCompletion,
  getPatientLegalStatusSummary,
  isPatientLegalStatusComplete,
  legalStatusDocumentStateText,
  normalizePatientLegalStatus,
  normalizePatientLegalStatusEvidence,
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
  it("serializes UI state back into the backend shape without the document-bound items", () => {
    // DSGVO consent and the confidentiality release follow signed documents
    // only (owner decision 2026-10-12): the card never sends them.
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
      identity_verified: false,
      document_pack_complete: false,
      compliance_completed: false,
      contract_status: "pending",
      notes: "Follow up next week",
    });
  });
});

describe("normalizePatientLegalStatusEvidence", () => {
  const status = normalizePatientLegalStatus({ dsgvo_signed: true, confidentiality_release_signed: true });

  it("reads the signed document, the document to sign and the flagged manual item", () => {
    const evidence = normalizePatientLegalStatusEvidence({
      dsgvo: {
        key: "dsgvo_signed",
        set: true,
        state: "signed",
        signed_document: {
          id: "doc-signed",
          name: "Einverständniserklärung zur Datenübermittlung",
          document_number: "EW-20261012-000001-V02",
          signed_at: "2026-10-12T08:30:00+00:00",
          source: "paper_signature",
        },
        pending_document: null,
        template_id: "privacy_consents",
      },
      confidentiality_release: {
        key: "confidentiality_release_signed",
        set: true,
        state: "manual",
        signed_document: null,
        pending_document: {
          id: "doc-draft",
          name: "Schweigepflichtsentbindung",
          document_number: null,
          signature_pending: true,
        },
        template_id: "confidentiality_release",
      },
    }, status);
    expect(evidence.dsgvo).toEqual({
      state: "signed",
      revokedAt: null,
      signedDocument: {
        id: "doc-signed",
        name: "Einverständniserklärung zur Datenübermittlung",
        documentNumber: "EW-20261012-000001-V02",
        signedAt: "2026-10-12T08:30:00+00:00",
        source: "paper_signature",
      },
      pendingDocument: null,
      templateId: "privacy_consents",
    });
    expect(evidence.confidentiality_release).toEqual({
      state: "manual",
      revokedAt: null,
      signedDocument: null,
      pendingDocument: {
        id: "doc-draft",
        name: "Schweigepflichtsentbindung",
        documentNumber: null,
        signaturePending: true,
      },
      templateId: "confidentiality_release",
    });
  });

  it("words the state with the Berlin signing day and the source", () => {
    const evidence = normalizePatientLegalStatusEvidence({
      dsgvo: {
        state: "signed",
        signed_document: { id: "doc", name: "Einverständniserklärung", signed_at: "2026-10-11T23:30:00Z", source: "paper_signature" },
        pending_document: null,
        template_id: "privacy_consents",
      },
      confidentiality_release: { state: "manual", signed_document: null, pending_document: null },
    }, status);
    expect(legalStatusDocumentStateText(evidence.dsgvo, "ru")).toBe("Подписано 12.10.2026 · скан на бумаге");
    expect(legalStatusDocumentStateText(evidence.dsgvo, "de")).toBe("Unterschrieben am 12.10.2026 · Papierunterschrift (Scan)");
    expect(legalStatusDocumentStateText(evidence.confidentiality_release, "ru")).toBe(
      "Отмечено вручную, подписанный документ отсутствует",
    );
    expect(legalStatusDocumentStateText(evidence.confidentiality_release, "de")).toBe(
      "Manuell markiert, kein unterschriebenes Dokument vorhanden",
    );
  });

  it("falls back to the stored flags without evidence", () => {
    const evidence = normalizePatientLegalStatusEvidence(undefined, {
      ...status,
      confidentialityReleaseSigned: false,
    });
    expect(evidence.dsgvo.state).toBe("signed");
    expect(evidence.confidentiality_release).toEqual({
      state: "missing",
      revokedAt: null,
      signedDocument: null,
      pendingDocument: null,
      templateId: "confidentiality_release",
    });
  });

  it("names the day a consent was revoked (owner decision 2026-10-12)", () => {
    const evidence = normalizePatientLegalStatusEvidence({
      dsgvo: {
        set: false,
        state: "revoked",
        revoked_at: "2026-10-11T22:30:00+00:00",
        signed_document: { id: "doc", name: "Einverständniserklärung", signed_at: "2026-09-01T08:00:00Z", source: "paper_signature" },
        pending_document: null,
        template_id: "privacy_consents",
      },
    }, { ...status, dsgvoSigned: false });
    expect(evidence.dsgvo.state).toBe("revoked");
    expect(evidence.dsgvo.revokedAt).toBe("2026-10-11T22:30:00+00:00");
    expect(legalStatusDocumentStateText(evidence.dsgvo, "ru")).toBe("Согласие отозвано 12.10.2026");
    expect(legalStatusDocumentStateText(evidence.dsgvo, "de")).toBe("Einwilligung am 12.10.2026 widerrufen");
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
