import { describe, expect, it } from "vitest";

import { formatDocumentSourceLabel } from "./document-source-labels";
import { t as translateCatalog } from "./i18n";

describe("formatDocumentSourceLabel", () => {
  const ru = translateCatalog("ru");
  const de = translateCatalog("de");

  it("names the system origins instead of showing the raw key", () => {
    for (const origin of [
      "staff",
      "document_translation",
      "teamlead_upload",
      "concierge_upload",
      "provider_upload",
      "invoice_import",
      "electronic_signature",
      "electronic_signature_package",
      "questionnaire",
      "interpreter_profile",
      "concierge_expense_receipt",
      "paper_signature",
      "lead_portal",
      "payer_link",
      "patient_portal",
      "legacy_import",
    ]) {
      expect(formatDocumentSourceLabel(origin, ru), origin).not.toBe(origin);
      expect(formatDocumentSourceLabel(origin, de), origin).not.toBe(origin);
    }
    expect(formatDocumentSourceLabel("paper_signature", ru)).toBe("Подписан на бумаге (скан)");
    // A known template is named (QA 2026-10-11).
    expect(formatDocumentSourceLabel("template:confidentiality_release", ru)).toBe(
      `${ru.documents_generate_from_template}: Освобождение от врачебной тайны`,
    );
    expect(formatDocumentSourceLabel("template:discharge_letter", ru)).toBe(
      ru.documents_generate_from_template,
    );
    expect(formatDocumentSourceLabel("auto_preparation:abc:def", de)).toBe(
      de.documents_generate_from_template,
    );
  });

  it("keeps names typed by staff", () => {
    expect(formatDocumentSourceLabel("Klinikum Nord", ru)).toBe("Klinikum Nord");
  });
});
