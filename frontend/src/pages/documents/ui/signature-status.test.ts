import { describe, expect, it } from "vitest";
import type { SignatureSummary } from "../data/use-signature-summary";
import { isClientSignableDocument, isInformationalDocument, signaturePresentation, signatureStatusText } from "./signature-status";

describe("isInformationalDocument", () => {
  it("recognises the attachments that are never signed themselves", () => {
    expect(isInformationalDocument({ generated_template_id: "privacy_information" })).toBe(true);
    expect(isInformationalDocument({ generated_template_id: "cost_estimate" })).toBe(true);
    expect(isInformationalDocument({ generated_template_id: "framework_contract" })).toBe(false);
    expect(isInformationalDocument({ generated_template_id: "privacy_consents" })).toBe(false);
    expect(isInformationalDocument({})).toBe(false);
  });

  it("goes by the template only, like the server: an uploaded file of the same kind stays signable", () => {
    const uploadedCostEstimate = { generated_template_id: null, art: "cost_estimate" };
    const contractFiledAsPrivacyInformation = { generated_template_id: "framework_contract", art: "privacy_information" };
    expect(isInformationalDocument(uploadedCostEstimate)).toBe(false);
    expect(isInformationalDocument(contractFiledAsPrivacyInformation)).toBe(false);
  });
});

describe("isClientSignableDocument", () => {
  it("offers the patient form and contracts but never GMED's own GwG records (QA 2026-10-10 B-9)", () => {
    expect(isClientSignableDocument({ generated_template_id: "lead_self_disclosure", art: "lead_self_disclosure" })).toBe(true);
    expect(isClientSignableDocument({ generated_template_id: "framework_contract", art: "framework_contract" })).toBe(true);
    expect(isClientSignableDocument({ generated_template_id: "enhanced_due_diligence", art: "enhanced_due_diligence" })).toBe(false);
    expect(isClientSignableDocument({ generated_template_id: null, compliance_kind: "enhanced_due_diligence", art: "document" })).toBe(false);
    expect(isClientSignableDocument({ generated_template_id: "gwg_identification", art: "gwg_identification" })).toBe(false);
  });

  it("leaves out attachments, medical files, identity scans and proofs", () => {
    expect(isClientSignableDocument({ generated_template_id: "privacy_information" })).toBe(false);
    expect(isClientSignableDocument({ generated_template_id: null, art: "report", is_medical: true })).toBe(false);
    expect(isClientSignableDocument({ generated_template_id: null, art: "passport_scan" })).toBe(false);
    expect(isClientSignableDocument({ generated_template_id: null, art: "payer_funds_proof" })).toBe(false);
    expect(isClientSignableDocument({ generated_template_id: null, art: "document", category: "identity" })).toBe(false);
  });
});

describe("signatureStatusText", () => {
  it("names every request status in both languages instead of the raw key", () => {
    const statuses = [
      "submitting",
      "submission_unknown",
      "pending",
      "completed",
      "needs_review",
      "declined",
      "withdrawn",
      "expired",
      "error",
    ];
    for (const lang of ["ru", "de"]) {
      const labels = statuses.map((status) => signatureStatusText(status, lang));
      expect(new Set(labels).size).toBe(statuses.length);
      for (const [index, label] of labels.entries()) {
        expect(label).not.toBe(statuses[index]);
      }
    }
    expect(signatureStatusText("expired", "de")).toBe("Anfrage abgelaufen");
    expect(signatureStatusText("unexpected", "ru")).toBe("Требует проверки");
  });
});

describe("signaturePresentation", () => {
  it("shows the verified document state ahead of an older failed request", () => {
    const staleRequest: SignatureSummary = {
      document_id: "document-1",
      status: "needs_review",
      test_mode: false,
      result_document_id: null,
    };

    const presentation = signaturePresentation(staleRequest, "ru", true);

    expect(presentation.label).toBe("Подписано");
    expect(presentation.className).toContain("text-emerald-700");
  });
});
