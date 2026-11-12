import { describe, expect, it } from "vitest";

import {
  canReadConciergeBillingQueue,
  conciergeQueueAction,
  conciergeQueueBadge,
  conciergeQueuePatients,
  filterConciergeQueue,
  patientBillingHref,
  patientLabel,
  type ConciergeBillingQueueItem,
} from "./model";

function item(id: string, patientId: string, name: string, pid: string | null): ConciergeBillingQueueItem {
  return {
    id,
    patient_id: patientId,
    patient_pid: pid,
    patient_name: name,
    order_id: null,
    order_number: null,
    title: `Service ${id}`,
    service_kind: "transfer",
    status: "completed",
    service_date: null,
    completed_at: null,
    quantity: "1",
    unit_price: "180",
    sale_price: "180",
    currency: "EUR",
  };
}

const rows = [
  item("a", "p2", "Zora Synth", "P-0002"),
  item("b", "p1", "Anna Synth", "P-0001"),
  item("c", "p2", "Zora Synth", "P-0002"),
  item("d", "p3", "", "P-0003"),
];

describe("concierge billing queue model", () => {
  it("is read by Billing, CEO, CEO assistant and patient managers only", () => {
    for (const role of ["billing", "ceo", "ceo_assistant", "patient_manager"]) {
      expect(canReadConciergeBillingQueue(role)).toBe(true);
    }
    for (const role of ["concierge", "sales", "interpreter", "patient", "it_admin", undefined]) {
      expect(canReadConciergeBillingQueue(role)).toBe(false);
    }
  });

  it("offers each patient once, sorted, and filters by patient", () => {
    expect(conciergeQueuePatients(rows)).toEqual([
      { id: "p1", label: "Anna Synth · P-0001" },
      { id: "p3", label: "P-0003" },
      { id: "p2", label: "Zora Synth · P-0002" },
    ]);
    expect(filterConciergeQueue(rows, "p2").map((row) => row.id)).toEqual(["a", "c"]);
    expect(filterConciergeQueue(rows, "")).toHaveLength(4);
    expect(patientLabel({ patient_name: " ", patient_pid: null })).toBe("—");
  });

  it("sends an unpriced service to its price, a reserved one to its draft, the rest to billing", () => {
    expect(conciergeQueueAction({ ...item("a", "p1", "Anna", null), sale_price: null })).toEqual({
      kind: "set_price",
      href: "/services?service=a",
    });
    expect(conciergeQueueAction({ ...item("b", "p1", "Anna", null), draft_invoice_id: "inv 1" })).toEqual({
      kind: "open_draft",
      href: "/invoices?invoice=inv%201",
    });
    expect(conciergeQueueAction(item("c", "p1", "Anna", null))).toEqual({
      kind: "bill",
      href: "/patients/p1?tab=billing",
    });
  });

  it("links to the patient's billing tab and shows a badge only for open work", () => {
    expect(patientBillingHref("p 1")).toBe("/patients/p%201?tab=billing");
    expect(conciergeQueueBadge(0)).toBeNull();
    expect(conciergeQueueBadge(3)).toBe("3");
    expect(conciergeQueueBadge(120)).toBe("99+");
  });
});
