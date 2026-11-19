import { describe, expect, it } from "vitest";

import { orderBudgetState, orderBudgetText, type OrderBudget } from "@/components/order-budget/order-budget";

import { finalInvoiceTotals } from "./final-invoice";
import { invoiceDisplayStatus, invoiceLineQuantityAvailable, isInvoiceSelectionValid, lineBlockedText } from "./invoice-model";
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

describe("order budget cent rounding (QA3 A S3-4 / D S3-1)", () => {
  const budget = {
    currency: "EUR",
    contract: null,
    contract_own_services_net: "513",
    contract_own_services_gross: "610.47",
    planned_own_services_net: "513",
    planned_own_services_gross: "610.48",
    invoiced_own_services_net: "513",
    invoiced_own_services_gross: "610.48",
    remaining_net: "0",
    remaining_gross: "0",
    over_by_net: null,
    over_by_gross: null,
  } as unknown as OrderBudget;

  it("shows no overrun of a cent when the nets agree", () => {
    const state = orderBudgetState(budget, { basis: "invoiced" });
    expect(state.kind).not.toBe("over");
    expect(orderBudgetText(state, "ru")).not.toContain("Превышение");
  });

  it("still shows a real overrun", () => {
    const over = { ...budget, invoiced_own_services_net: "600", invoiced_own_services_gross: "714" } as OrderBudget;
    expect(orderBudgetState(over, { basis: "invoiced" }).kind).toBe("over");
  });
});

describe("final status after the advance set-off (QA3 A S3-15)", () => {
  it("reads «advance set off» instead of part paid when only the advance was applied", () => {
    expect(invoiceDisplayStatus({ status: "partially_paid", amount_to_pay: "100", prepayment_applied_amount: "300", paid_amount: "0" }))
      .toBe("advance_set_off");
    expect(invoiceDisplayStatus({ status: "partially_paid", amount_to_pay: "100", prepayment_applied_amount: "300", paid_amount: "50" }))
      .toBe("partially_paid");
  });
});

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
