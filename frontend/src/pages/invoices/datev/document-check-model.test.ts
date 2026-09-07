import { describe, expect, it } from "vitest";
import type { InvoiceImportPreview } from "../model/import-model";
import { checkableInvoiceFile, documentCheckReport, invoiceCheckSummary, matchingInvoice, type DocumentCheck } from "./document-check-model";

const file = new File(["%PDF-test"], "invoice.pdf", { type: "application/pdf" });
const preview: InvoiceImportPreview = {
  schema_version: "1.0", requires_review: true, extraction_complete: true, source_format: "pdf_text", warnings: [],
  fields: { supplier_name: "Example GmbH", external_invoice_number: "INV-01", invoice_date: "2026-09-06", due_date: "", amount_net: "100.00", amount_vat: "19.00", amount_gross: "119.00", currency: "EUR" },
  text: "Sensitive full document text", recipient: { name: "Sensitive recipient" },
};
describe("document preflight", () => {
  it("normalizes browser XML MIME and rejects unsupported or empty uploads", () => {
    expect(checkableInvoiceFile(new File(["<Invoice/>"], "example.XML", { type: "text/xml" }))?.type).toBe("application/xml");
    expect(checkableInvoiceFile(new File([], "empty.pdf", { type: "application/pdf" }))).toBeNull();
    expect(checkableInvoiceFile(new File(["active"], "document.html", { type: "text/html" }))).toBeNull();
    expect(checkableInvoiceFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.xml"))).toBeNull();
  });
  it("recognizes complete basic fields without treating an optional due date as missing", () => {
    expect(invoiceCheckSummary(file, preview).issues).toEqual([]);
    expect(invoiceCheckSummary(file, preview).structured_validation).toBeNull();
  });
  it("does not turn ordinary generic extraction and documented derivations into errors", () => {
    const result = invoiceCheckSummary(file, { ...preview, warnings: ["template_not_found", "generic_extraction_review_required", "amount_net_derived_from_totals", "due_date_calculated_from_invoice_date"] });
    expect(result.issues).toEqual([]);
    expect(result.warnings).toHaveLength(4);
    expect(invoiceCheckSummary(file, { ...preview, warnings: ["unknown_parser_warning"] }).issues).toContain("parser_warning");
  });
  it("flags invalid calendar dates, missing amounts and totals that differ by a cent", () => {
    const result = invoiceCheckSummary(file, { ...preview, fields: { ...preview.fields, invoice_date: "2026-02-30", amount_gross: "119.01", supplier_name: "" } });
    expect(result.issues).toEqual(expect.arrayContaining(["invoice_date", "totals", "required_fields"]));
    expect(invoiceCheckSummary(file, { ...preview, fields: { ...preview.fields, invoice_date: "2024-02-29" } }).issues).toEqual([]);
  });
  it("retains parser warnings and blocks unsupported structured invoices", () => {
    const result = invoiceCheckSummary(file, { ...preview, extraction_complete: false, warnings: ["tax_treatment_requires_review"],
      structured: { syntax: "cii", profile: null, document_type: "381", validation: "basic_checks", import_allowed: false },
      source_differences: [{ field: "amount_gross", structured: "119.00", visible: "129.00" }] });
    expect(result.issues).toEqual(expect.arrayContaining(["incomplete", "structure", "source_difference", "parser_warning"]));
    expect(result.warnings).toContain("tax_treatment_requires_review");
    expect(result.structured_validation).toBe("basic_checks");
  });
  it("flags repeated invoice identity even when the gross amount differs", () => {
    const row: DocumentCheck = { id: "first", file, status: "parsed", summary: invoiceCheckSummary(file, preview) };
    const candidate = invoiceCheckSummary(file, { ...preview, fields: { ...preview.fields, supplier_name: "  EXAMPLE   GmbH ", amount_gross: "129.00" } });
    expect(matchingInvoice(candidate, [row])?.id).toBe("first");
    expect(matchingInvoice({ ...candidate, fields: { ...candidate.fields, supplier_name: "" } }, [row])).toBeUndefined();
  });
  it("exports an honest diagnostic report without the original text or recipient", () => {
    const rows: DocumentCheck[] = [{ id: "first", file, status: "parsed", sha256: "a".repeat(64), summary: invoiceCheckSummary(file, preview) }];
    const report = documentCheckReport(rows, "2026-09-06T10:00:00Z");
    expect(report.datev_compatibility_verified).toBe(false);
    expect(report.accounting_writes_performed).toBe(false);
    expect(report.documents[0].filename).toBe("invoice.pdf");
    expect(JSON.stringify(report)).not.toContain("Sensitive");
    expect(JSON.stringify(report)).not.toContain("%PDF-test");
  });
});
