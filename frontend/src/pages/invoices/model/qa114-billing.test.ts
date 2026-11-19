import { describe, expect, it } from "vitest";

import { finalInvoiceTotals } from "./final-invoice";
import { invoiceLineQuantityAvailable, isInvoiceSelectionValid, lineBlockedText } from "./invoice-model";
import type { CreateForm, DeliveredOrderService, InvoiceLineItem } from "./types";

function line(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return {
    description: "Dolmetscherstunden",
    quantity: "2",
    unit_price: "95",
    vat_rate: "19",
    is_cost_passthrough: false,
    line_net: "190",
    line_vat: "36.1",
    line_gross: "226.1",
    invoiced_quantity: "0",
    invoiced_net: "0",
    invoiced_gross: "0",
    remaining_quantity: "2",
    final_quantity: "2",
    ...overrides,
  };
}

const extra: DeliveredOrderService = {
  order_leistung_id: "svc-1",
  description: "Zusatzbegleitung",
  name: "Zusatzbegleitung",
  quantity: "2",
  unit_price: "80",
  vat_rate: "19",
  is_cost_passthrough: false,
  quote_line_index: null,
};

function form(overrides: Partial<CreateForm>): CreateForm {
  return {
    invoiceType: "interim",
    selectedLineIndexes: [],
    lineQuantities: {},
    orderServiceQuantities: {},
    ...overrides,
  } as CreateForm;
}

describe("QA3 billing rules in the create dialog (qa-fix-114)", () => {
  it("never offers the estimated outlays on an interim", () => {
    const outlays = line({ description: "Voraussichtliche Auslagen", is_cost_passthrough: true, interim_blocked: "estimated_outlays" });
    expect(invoiceLineQuantityAvailable(outlays, "interim")).toBe(0);
    expect(invoiceLineQuantityAvailable(outlays, "advance")).toBe(2);
    expect(lineBlockedText(outlays, "interim", false)).toContain("Ожидаемые расходы");
  });

  it("offers no line whose terms changed after the estimate", () => {
    const changed = line({ terms_outdated: true });
    expect(invoiceLineQuantityAvailable(changed, "interim")).toBe(0);
    expect(lineBlockedText(changed, "final", false)).toContain("Смета устарела");
  });

  it("accepts an interim of services outside the estimate only", () => {
    const lines = [line()];
    expect(isInvoiceSelectionValid(lines, form({ orderServiceQuantities: { "svc-1": "2" } }), [extra])).toBe(true);
    expect(isInvoiceSelectionValid(lines, form({ orderServiceQuantities: { "svc-1": "3" } }), [extra])).toBe(false);
    expect(isInvoiceSelectionValid(lines, form({}), [extra])).toBe(false);
  });

  it("subtracts the credit of a quantity billed before and never delivered", () => {
    const outlays = line({
      description: "Voraussichtliche Auslagen",
      quantity: "1",
      unit_price: "1500",
      vat_rate: "0",
      is_cost_passthrough: true,
      final_quantity: "0",
      invoiced_quantity: "1",
      not_delivered_credit_quantity: "1",
      not_delivered_credit_net: "1500",
      not_delivered_credit_gross: "1500",
    });
    const totals = finalInvoiceTotals([line(), outlays], { selectedLineIndexes: [0, 1], lineQuantities: { "0": "2", "1": "0" }, orderServiceQuantities: {} });
    expect(totals.gross).toBe(226.1 - 1500);
  });
});
