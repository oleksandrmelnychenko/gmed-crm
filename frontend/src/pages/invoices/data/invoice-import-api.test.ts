import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import { blankImportFields } from "../model/import-model";
import { confirmCompanyInvoiceImport, confirmInvoiceImport, discardInvoiceImportSource, uploadInvoiceSource } from "./invoice-import-api";

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
        provider_id: null,
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

describe("patient invoice context", () => {
  it("keeps the patient on the original without inventing an order", async () => {
    await uploadInvoiceSource(new File(["%PDF-test"], "invoice.pdf"), "patient_order", "patient-1", "", fields);
    const body = request.mock.calls[0][1]?.body as FormData;
    expect(body.get("patient_id")).toBe("patient-1");
    expect(body.has("order_id")).toBe(false);
    expect(body.get("invoice_scope")).toBe("patient_order");
  });
  it.each([ ["", "/patients/patient-1/external-invoices"], ["order-1", "/orders/order-1/external-invoices"] ])("confirms the reviewed source with order '%s'", async (order, path) => {
    await confirmInvoiceImport("document-1", "patient-1", order, fields, "Reviewed");
    expect(request.mock.calls[0][0]).toBe(path);
    expect(JSON.parse(request.mock.calls[0][1]?.body as string)).toMatchObject({ patient_id: "patient-1", source_document_id: "document-1", amount_gross: 779.45, status: "received", paid_by: "unpaid" });
  });
});
