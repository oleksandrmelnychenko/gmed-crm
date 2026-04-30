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
