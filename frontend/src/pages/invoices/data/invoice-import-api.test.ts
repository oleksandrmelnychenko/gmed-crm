import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import { blankImportFields } from "../model/import-model";
import { confirmCompanyInvoiceImport, discardInvoiceImportSource, uploadInvoiceSource } from "./invoice-import-api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const request = vi.mocked(apiFetch);
const fields = {
  ...blankImportFields(),
  supplier_name: "K.B.M. GmbH",
  external_invoice_number: "RE 2026-086",
  invoice_date: "2026-05-10",
  due_date: "2026-05-24",
  amount_net: "655.00",
  amount_vat: "124.45",
  amount_gross: "779.45",
  currency: "EUR",
};

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({ id: "invoice-1" });
});

describe("company invoice import", () => {
  it("uploads the original outside patient and order context", async () => {
    const file = new File(["%PDF-test"], "supplier.pdf", { type: "application/pdf" });
    await uploadInvoiceSource(file, "company", "patient-must-not-leak", "order-must-not-leak", fields);

    expect(request).toHaveBeenCalledTimes(1);
    const [path, options] = request.mock.calls[0];
    expect(path).toBe("/invoices/import-document");
    const body = options?.body as FormData;
    expect(body.get("invoice_scope")).toBe("company");
    expect(body.get("patient_id")).toBeNull();
    expect(body.get("order_id")).toBeNull();
    expect(body.get("source_institution")).toBe("K.B.M. GmbH");
  });

  it("confirms the supplier payable with exact reviewed totals", async () => {
    await confirmCompanyInvoiceImport("document-1", fields, "Reviewed against original");

    expect(request).toHaveBeenCalledExactlyOnceWith("/external-invoices/company", {
      method: "POST",
      body: JSON.stringify({
        source_document_id: "document-1",
        supplier_name: "K.B.M. GmbH",
        external_invoice_number: "RE 2026-086",
        invoice_date: "2026-05-10",
        due_date: "2026-05-24",
        amount_net: 655,
        amount_vat: 124.45,
        amount_gross: 779.45,
        currency: "EUR",
        notes: "Reviewed against original",
      }),
    });
  });

  it("discards an unfinished source before replacement", async () => {
    await discardInvoiceImportSource("document-1");

    expect(request).toHaveBeenCalledExactlyOnceWith("/documents/document-1/delete", {
      method: "POST",
      body: JSON.stringify({ reason: "Replaced before invoice import completion" }),
    });
  });
});
