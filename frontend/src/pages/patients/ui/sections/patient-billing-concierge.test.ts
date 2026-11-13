import { describe, expect, it } from "vitest";

import {
  conciergeLineAmounts,
  conciergeServiceState,
  formatBillingQuantity,
  hasSalePrice,
  type BillingConciergeService,
} from "./patient-billing-concierge";

function service(overrides: Partial<BillingConciergeService> = {}): BillingConciergeService {
  return {
    id: "s1",
    title: "Airport transfer",
    service_kind: "transfer",
    order_id: "o1",
    order_number: "A-1",
    service_date: null,
    currency: "EUR",
    quantity: "1",
    unit_price: "120",
    sale_price_net: "120",
    invoice_id: null,
    invoice_number: null,
    billable: true,
    ...overrides,
  };
}

describe("concierge services in the patient billing tab", () => {
  it("offers a priced ready service on a draft of its order or before an order is chosen", () => {
    expect(conciergeServiceState(service(), { orderId: "o1", currency: "EUR" })).toBe("selectable");
    expect(conciergeServiceState(service(), { orderId: "", currency: "EUR" })).toBe("selectable");
    expect(conciergeServiceState(service({ order_id: null }), { orderId: "o2", currency: "EUR" })).toBe("selectable");
  });

  it("does not offer a service without price, on a draft, of another order or currency", () => {
    const unpriced = service({ unit_price: null, sale_price_net: null, billable: false });
    expect(hasSalePrice(unpriced)).toBe(false);
    expect(conciergeServiceState(unpriced, { orderId: "o1", currency: "EUR" })).toBe("no_price");
    expect(conciergeServiceState(service({ invoice_id: "i1", billable: false }), { orderId: "o1", currency: "EUR" })).toBe("in_draft");
    expect(conciergeServiceState(service(), { orderId: "o2", currency: "EUR" })).toBe("other_order");
    expect(conciergeServiceState(service(), { orderId: "o1", currency: "USD" })).toBe("other_currency");
  });

  it("adds the VAT on the rounded net like the server", () => {
    expect(conciergeLineAmounts(service(), "19")).toEqual({ net: 120, vat: 22.8, gross: 142.8 });
    expect(conciergeLineAmounts(service({ sale_price_net: "49.99" }), "19")).toEqual({ net: 49.99, vat: 9.5, gross: 59.49 });
    expect(conciergeLineAmounts(service(), null)).toEqual({ net: 120, vat: 0, gross: 120 });
  });
});

describe("formatBillingQuantity (QA 2026-11-13 F-B6)", () => {
  it("writes a quantity in German like the invoice PDF", () => {
    expect(formatBillingQuantity(2.5)).toBe("2,5");
    expect(formatBillingQuantity("2.5000")).toBe("2,5");
    expect(formatBillingQuantity(3)).toBe("3");
    expect(formatBillingQuantity("1.125")).toBe("1,125");
  });
});
