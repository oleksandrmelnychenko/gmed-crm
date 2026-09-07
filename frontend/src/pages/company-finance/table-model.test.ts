import { describe, expect, it } from "vitest";
import { filterPatientPositions, filterProviderDocuments, filterProviderPositions, providerDisplayName, providerGroupKey } from "./table-model";
import type { CompanyPatientPosition, CompanyProviderLiability, CompanyProviderPosition } from "./types";

const supplier: CompanyProviderPosition = { provider_id: null, provider_name: "Telekom Deutschland GmbH", invoice_total_gross: "300", company_paid_gross: "150", payable_remaining_gross: "100", expected_remaining_gross: "50", invoice_count: 4, open_invoice_count: 2, partial_invoice_count: 1, settled_invoice_count: 1, latest_payment_on: null };
const invoice = (id: string, patch: Partial<CompanyProviderLiability> = {}): CompanyProviderLiability => ({ id, provider_id: null, provider_name: supplier.provider_name, external_invoice_number: id, invoice_date: null, due_date: null, status: "approved", paid_by: "unpaid", liability_kind: "payable", amount_gross: "100", company_paid_gross: "0", remaining_gross: "100", settlement_status: "unpaid", latest_payment_on: null, payment_count: 0, order_id: null, order_number: null, patient_id: null, patient_pid: null, patient_name: "", ...patch });
const documents = [invoice("OPEN"), invoice("PARTIAL", { settlement_status: "partial" }), invoice("PAID", { liability_kind: "settled", settlement_status: "paid" }), invoice("EXPECTED", { liability_kind: "expected", status: "expected" })];

describe("company finance table identity and filters", () => {
  it("shows named suppliers even without registry IDs and isolates their documents", () => {
    expect(providerDisplayName(supplier, "Unknown")).toBe("Telekom Deutschland GmbH");
    expect(providerDisplayName({ ...supplier, provider_name: " " }, "Unknown")).toBe("Unknown");
    expect(providerGroupKey(supplier)).toBe(providerGroupKey({ ...supplier, provider_name: " TELEKOM   Deutschland GmbH " }));
    const other = invoice("OTHER", { provider_name: "Stadtwerke" });
    const unknown = invoice("UNKNOWN", { provider_name: null });
    const linked = invoice("LINKED", { provider_id: "provider-1" });
    expect(new Set([supplier, other, unknown, linked].map(providerGroupKey)).size).toBe(4);
    expect(filterProviderDocuments([...documents, other, unknown, linked], "all", providerGroupKey(supplier)).map(row => row.id)).toEqual(["OPEN", "PARTIAL", "PAID", "EXPECTED"]);
  });
  it("keeps mixed suppliers in each applicable status and drills into the same status", () => {
    for (const [status, ids] of [["open", ["OPEN", "PARTIAL"]], ["partial", ["PARTIAL"]], ["settled", ["PAID"]], ["expected", ["EXPECTED"]]] as const) {
      expect(filterProviderPositions([supplier], documents, status, null, "")).toEqual([supplier]);
      expect(filterProviderDocuments(documents, status, providerGroupKey(supplier)).map(row => row.id)).toEqual(ids);
    }
  });
  it("combines status, selected supplier and text search without changing totals", () => {
    const other = { ...supplier, provider_id: "provider-2", provider_name: "Other Clinic" };
    const rows = [...documents, invoice("OTHER", { provider_id: other.provider_id, provider_name: other.provider_name })];
    expect(filterProviderPositions([supplier, other], rows, "all", null, " telekom ")).toEqual([supplier]);
    expect(filterProviderPositions([supplier, other], rows, "settled", null, "PAID")).toEqual([supplier]);
    expect(filterProviderPositions([supplier, other], rows, "open", null, "PAID")).toEqual([]);
    expect(filterProviderDocuments(rows, "all", providerGroupKey(supplier), "OTHER")).toEqual([]);
    expect(filterProviderPositions([supplier, other], rows, "all", providerGroupKey(supplier), "")).toEqual([supplier]);
    expect(supplier.invoice_total_gross).toBe("300");
  });
  it("searches patient names and IDs alongside balance and reconciliation filters", () => {
    const patient: CompanyPatientPosition = { patient_id: "p1", patient_pid: "P-001", patient_name: "Toni Müller", is_active: true, invoice_due: "450", external_receivable: "0", manual_balance: "0", available_prepayment: "0", calculated_balance: "450", balance_side: "debit", reconciliation_required: true };
    expect(filterPatientPositions([patient], "debit", "müller")).toEqual([patient]);
    expect(filterPatientPositions([patient], "reconciliation", "P-001")).toEqual([patient]);
    expect(filterPatientPositions([patient], "credit", "Toni")).toEqual([]);
    expect(filterPatientPositions([patient], "all", "missing")).toEqual([]);
  });
});
