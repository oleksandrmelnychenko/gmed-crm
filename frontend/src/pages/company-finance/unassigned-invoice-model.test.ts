import { describe, expect, it } from "vitest";

import { canCorrectUnassignedInvoice } from "./unassigned-invoice-model";

describe("canCorrectUnassignedInvoice", () => {
  const base = { order_id: null, paid_by: "unpaid" as const, company_paid_gross: "0", status: "approved" };

  it("allows correcting an unpaid invoice without an order", () => {
    for (const status of ["expected", "received", "approved", "overdue"]) {
      expect(canCorrectUnassignedInvoice({ ...base, status })).toBe(true);
    }
  });

  it("keeps order invoices, paid and cancelled invoices unchanged", () => {
    expect(canCorrectUnassignedInvoice({ ...base, order_id: "order-1" })).toBe(false);
    expect(canCorrectUnassignedInvoice({ ...base, company_paid_gross: "10.00" })).toBe(false);
    expect(canCorrectUnassignedInvoice({ ...base, status: "paid", paid_by: "patient" })).toBe(false);
    expect(canCorrectUnassignedInvoice({ ...base, status: "cancelled" })).toBe(false);
  });
});
