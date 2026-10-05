import { describe, expect, it } from "vitest";
import type { SignatureSummary } from "../data/use-signature-summary";
import { isInformationalDocument, signaturePresentation, signatureStatusText } from "./signature-status";

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
