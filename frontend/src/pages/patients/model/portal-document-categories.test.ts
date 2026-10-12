import { describe, expect, it } from "vitest";

import { portalDocumentCategoryKey } from "./portal-document-categories";

describe("portalDocumentCategoryKey", () => {
  it("keeps clinic correspondence separate from lab analysis", () => {
    expect(
      portalDocumentCategoryKey({
        art: "clinic_letter",
        category: "clinic_correspondence",
        is_medical: false,
      }),
    ).toBe("correspondence");

    expect(
      portalDocumentCategoryKey({
        art: "blood_results",
        category: "lab_analysis",
        is_medical: true,
      }),
    ).toBe("analyses");
  });

  it("files consents and contracts under their own chip, not correspondence (QA 2026-10-12 B2-13)", () => {
    for (const [art, category] of [
      ["confidentiality_release", "consent"],
      ["privacy_consents", "consent"],
      ["consent_data_release", "consent"],
      ["dsgvo", null],
      ["framework_contract", "contract"],
    ] as const) {
      expect(portalDocumentCategoryKey({ art, category, is_medical: false }), art).toBe("consents");
    }
  });

  it("classifies conclusions, invoices and translations explicitly", () => {
    expect(
      portalDocumentCategoryKey({
        art: "discharge_report",
        category: "medical_report",
        is_medical: true,
      }),
    ).toBe("conclusions");

    expect(
      portalDocumentCategoryKey({
        art: "invoice_pdf",
        category: "invoice",
        is_medical: false,
      }),
    ).toBe("invoices");

    expect(
      portalDocumentCategoryKey({
        art: "translated_letter",
        category: "translation",
        is_medical: false,
      }),
    ).toBe("translations");
  });
});
