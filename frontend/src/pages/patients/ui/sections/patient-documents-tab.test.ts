import { describe, expect, it } from "vitest";

import { canRecognizePatientDocument } from "./patient-documents-tab";

describe("canRecognizePatientDocument", () => {
  it("allows supported medical PDF and image documents", () => {
    expect(
      canRecognizePatientDocument({
        filename: "laboratory.pdf",
        category: "medical_report",
        is_medical: true,
        mime_type: "application/pdf",
      }),
    ).toBe(true);
    expect(
      canRecognizePatientDocument({
        filename: "scan.png",
        category: "medical_report",
        is_medical: true,
        mime_type: "image/png; charset=binary",
      }),
    ).toBe(true);
  });

  it("falls back to the file extension when MIME type is absent", () => {
    expect(
      canRecognizePatientDocument({
        filename: "laboratory.JPG",
        category: "medical_lab",
        is_medical: true,
        mime_type: null,
      }),
    ).toBe(true);
  });

  it("rejects non-medical or unsupported documents", () => {
    expect(
      canRecognizePatientDocument({
        filename: "consent.pdf",
        category: "consent",
        is_medical: false,
        mime_type: "application/pdf",
      }),
    ).toBe(false);
    expect(
      canRecognizePatientDocument({
        filename: "notes.docx",
        category: "medical_report",
        is_medical: true,
        mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe(false);
  });

  it("supports a staged backend rollout by recognizing medical category codes", () => {
    expect(
      canRecognizePatientDocument({
        filename: "laboratory.pdf",
        category: "medical_report",
        mime_type: null,
      }),
    ).toBe(true);
  });
});
