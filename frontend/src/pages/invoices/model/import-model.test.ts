import { describe, expect, it } from "vitest";
import { blankImportFields, importFieldIsRecognized, importFieldsFromPreview, importMoneyCents, importTotalsMatch, invoiceSourceCanSave, normalizeInvoiceFile, type InvoiceImportPreview } from "./import-model";

describe("reviewed invoice amounts", () => {
  it("requires successful supported XML preview while keeping PDF manual review", async () => {
    const original = new File(["<Invoice/>"], "RECHNUNG.XML", { type: "text/xml" });
    const file = normalizeInvoiceFile(original);
    expect(file.type).toBe("application/xml");
    expect(await file.text()).toBe(await original.text());
    expect(invoiceSourceCanSave(file, null)).toBe(false);
    expect(invoiceSourceCanSave(new File(["%PDF"], "invoice.pdf"), null)).toBe(true);
    const preview: InvoiceImportPreview = { schema_version: "1.0", requires_review: true, fields: {}, warnings: [], text: "", extraction_complete: true,
      source_format: "xml", structured: { syntax: "cii", profile: null, document_type: "380", validation: "basic_checks", import_allowed: true } };
    expect(invoiceSourceCanSave(file, preview)).toBe(true);
    preview.structured!.import_allowed = false;
    expect(invoiceSourceCanSave(file, preview)).toBe(false);
    expect(invoiceSourceCanSave(new File(["%PDF"], "hybrid.pdf"), preview)).toBe(false);
  });
  it("accepts decimal comma and checks totals without floating point rounding", () => {
    expect(importMoneyCents(" 123,45 ")).toBe(12345);
    expect(importMoneyCents("0.1")).toBe(10);
    expect(importTotalsMatch({ ...blankImportFields(), amount_net: "0.1", amount_vat: "0.2", amount_gross: "0.3" })).toBe(true);
  });
  it("reads German thousands, refuses English grouping, signs and excess precision", () => {
    expect(importMoneyCents("1.234")).toBe(123400);
    expect(importMoneyCents("1.234,56")).toBe(123456);
    for (const value of ["", "1,234.56", "-1", "NaN", "1e3", "9999999999999999", "12,345"]) {
      expect(importMoneyCents(value)).toBeNull();
    }
    const fields = { ...blankImportFields(), amount_net: "100", amount_gross: "100" };
    expect(importTotalsMatch(fields)).toBe(false);
    expect(importTotalsMatch({ ...fields, amount_vat: "0" })).toBe(true);
    expect(importTotalsMatch({ ...fields, amount_vat: "19" })).toBe(false);
  });
  it("keeps missing OCR fields empty for explicit review", () => {
    const fields = importFieldsFromPreview({ schema_version: "1.0", requires_review: true,
      fields: { amount_gross: "119.00", amount_vat: null }, warnings: ["template_not_found"], text: "invoice", extraction_complete: false });
    expect(fields.amount_gross).toBe("119,00");
    expect(fields.amount_vat).toBe("");
    expect(fields.currency).toBe("");
    expect(importTotalsMatch(fields)).toBe(false);
  });
  // Owner 2026-11-11: recognized amounts are shown as staff type money.
  it("shows recognized amounts in the German format and still knows them as recognized", () => {
    const preview = { schema_version: "1.0", requires_review: true,
      fields: { amount_net: "1234.50", amount_vat: "0.00", supplier_name: "Shop" }, warnings: [], text: "invoice", extraction_complete: true };
    const fields = importFieldsFromPreview(preview);
    expect(fields.amount_net).toBe("1234,50");
    expect(fields.amount_vat).toBe("0,00");
    expect(importFieldIsRecognized("amount_net", "1234,50", preview)).toBe(true);
    expect(importFieldIsRecognized("amount_net", "1.234,50", preview)).toBe(true);
    expect(importFieldIsRecognized("amount_vat", "1.00", preview)).toBe(false);
    expect(importFieldIsRecognized("supplier_name", "Shop", preview)).toBe(true);
  });
});
