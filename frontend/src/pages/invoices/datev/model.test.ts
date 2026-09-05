import { describe, expect, it } from "vitest";
import { DATEV_DEMO_INVOICES, filterDemoInvoices, isValidDemoBinding, suggestDemoPatient } from "./model";

describe("DATEV demo isolation and assignment", () => {
  it("matches a known recipient and leaves an unknown recipient unassigned", () => {
    expect(DATEV_DEMO_INVOICES.map(suggestDemoPatient)).toEqual(["demo-patient-1", "demo-patient-2", ""]);
  });
  it("rejects real IDs, a different patient's order, and unknown invoices", () => {
    expect(isValidDemoBinding("demo-datev-001", { patientId: "demo-patient-1", orderId: "demo-order-1" })).toBe(true);
    expect(isValidDemoBinding("demo-datev-001", { patientId: "demo-patient-2", orderId: "demo-order-1" })).toBe(false);
    expect(isValidDemoBinding("demo-datev-001", { patientId: "00000000-0000-0000-0000-000000000001", orderId: "demo-order-1" })).toBe(false);
    expect(isValidDemoBinding("real-invoice", { patientId: "demo-patient-1", orderId: "demo-order-1" })).toBe(false);
  });
  it("counts only confirmed bindings and searches the assigned client", () => {
    const bindings = { "demo-datev-003": { patientId: "demo-patient-2", orderId: "demo-order-3" } };
    expect(filterDemoInvoices("", "linked", {})).toHaveLength(0);
    expect(filterDemoInvoices("Mia", "linked", bindings).map((row) => row.id)).toEqual(["demo-datev-003"]);
    expect(filterDemoInvoices("", "unlinked", bindings)).toHaveLength(2);
  });
});
