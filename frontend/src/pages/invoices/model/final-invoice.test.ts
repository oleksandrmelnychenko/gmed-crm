import { describe, expect, it } from "vitest";

import { moneyFinalLinePartAmounts } from "@/lib/money";

import {
  createFinalInvoiceSelection,
  finalInvoiceSummary,
  finalInvoiceTotals,
  finalLineComparison,
  finalOrderServicesPayload,
  formatFinalDifference,
  isFinalSelectionValid,
} from "./final-invoice";
import { invoiceLineSelectionPayload } from "./invoice-model";
import type { CreateForm, DeliveredOrderService, InvoiceLineItem } from "./types";

// 3 h interpreter at 60,00 net, 19 %: 180,00 / 34,20 / 214,20.
function hours(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return {
    description: "Dolmetscherstunden",
    quantity: "3",
    unit: "hour",
    unit_price: "60",
    vat_rate: "19",
    is_cost_passthrough: false,
    line_net: "180",
    line_vat: "34.2",
    line_gross: "214.2",
    invoiced_quantity: "0",
    invoiced_net: "0",
    invoiced_gross: "0",
    remaining_quantity: "3",
    delivery_basis: "actual",
    final_quantity: "5",
    ...overrides,
  };
}

const transfer: InvoiceLineItem = {
  description: "Transfer",
  quantity: "2",
  unit_price: "50",
  vat_rate: "19",
  is_cost_passthrough: false,
  line_net: "100",
  line_vat: "19",
  line_gross: "119",
  invoiced_quantity: "0",
  invoiced_net: "0",
  invoiced_gross: "0",
  remaining_quantity: "2",
  delivery_basis: "estimate",
  final_quantity: "2",
};

const extraVisit: DeliveredOrderService = {
  order_leistung_id: "svc-1",
  description: "Behandlungsorganisation",
  name: "Behandlungsorganisation",
  quantity: "1",
  unit_price: "100",
  vat_rate: "19",
  is_cost_passthrough: false,
  quote_line_index: null,
};

function form(lines: InvoiceLineItem[], extras: DeliveredOrderService[] = []): CreateForm {
  return {
    advanceBasis: "positions",
    quoteId: "q",
    invoiceType: "final",
    dueDate: "",
    notes: "",
    internalNote: "",
    lineComments: {},
    ...createFinalInvoiceSelection(lines, extras),
  };
}

describe("final invoice proposal", () => {
  it("proposes the delivered quantity, not the estimate", () => {
    const lines = [hours(), transfer];
    const selection = createFinalInvoiceSelection(lines, [extraVisit]);
    expect(selection.lineQuantities).toEqual({ 0: "5", 1: "2" });
    expect(selection.orderServiceQuantities).toEqual({ "svc-1": "1" });
  });

  it("shows hours above the estimate with their difference", () => {
    const lines = [hours()];
    const comparison = finalLineComparison(lines[0], 0, form(lines));
    expect(comparison).toMatchObject({ estimate: 3, actual: 5, difference: 2, aboveEstimate: true, recorded: true });
    expect(comparison.differenceGross).toBe(142.8);
    expect(formatFinalDifference(comparison.difference, comparison.differenceGross, (value) => `${value} ч`, (value) => `${value.toFixed(2)} €`))
      .toBe("+2 ч · +142.80 €");
    expect(finalInvoiceTotals(lines, form(lines)).gross).toBe(357);
  });

  it("shows hours below the estimate and a line not delivered", () => {
    const lines = [hours({ final_quantity: "2" }), transfer];
    const current = form(lines);
    const below = finalLineComparison(lines[0], 0, current);
    expect(below).toMatchObject({ difference: -1, differenceGross: -71.4, aboveEstimate: false });
    current.lineQuantities["1"] = "0";
    expect(finalLineComparison(lines[1], 1, current).notDelivered).toBe(true);
    // The line at 0 is left out of the request.
    expect(invoiceLineSelectionPayload(current)).toEqual([{ line_index: 0, quantity: 2 }]);
    expect(finalInvoiceSummary({ line_items: lines }, current)).toEqual({ estimate: 333.2, actual: 142.8, difference: -190.4 });
  });

  it("counts delivered units outside the estimate under their line", () => {
    const lines = [hours({ final_quantity: "0" })];
    const sibling = { ...extraVisit, unit_price: "60", quantity: "2", quote_line_index: 0 };
    const current = form(lines, [sibling]);
    expect(finalLineComparison(lines[0], 0, current, [sibling])).toMatchObject({ actual: 2, difference: -1 });
    expect(finalOrderServicesPayload(current, [sibling])).toEqual([{ order_leistung_id: "svc-1", quantity: 2 }]);
  });

  it("needs a quantity of at least 0 everywhere and something to bill", () => {
    const lines = [hours()];
    const current = form(lines, [extraVisit]);
    expect(isFinalSelectionValid(lines, current, [extraVisit])).toBe(true);
    current.lineQuantities["0"] = "-1";
    expect(isFinalSelectionValid(lines, current, [extraVisit])).toBe(false);
    current.lineQuantities["0"] = "0";
    current.orderServiceQuantities = { "svc-1": "0" };
    expect(isFinalSelectionValid(lines, current, [extraVisit])).toBe(false);
  });

  it("prices hours beyond an interim invoice like the server", () => {
    // 1 h billed by an interim invoice, 4 h more on the final.
    expect(moneyFinalLinePartAmounts({
      quantity: 4,
      unitPriceNet: 60,
      vatRatePercent: 19,
      lineQuantity: 3,
      billedQuantity: 1,
      lineNet: 180,
      lineGross: 214.2,
      billedNet: 60,
      billedGross: 71.4,
    })).toEqual({ net: 240, vat: 45.6, gross: 285.6 });
  });
});

describe("a legacy (seed) quote line", () => {
  it("is totalled with the VAT rate and amounts the quote API fills in (QA verify2 D-O1)", () => {
    // As GET /quotes returns a seed line stored without vat_rate / line amounts.
    const seed = {
      description: "Treatment package",
      quantity: 1 as unknown as string,
      unit_price: "1000.00",
      total_gross: "1000.00",
      vat_rate: "0",
      line_net: "1000.00",
      line_vat: "0.00",
      line_gross: "1000.00",
      invoiced_quantity: "0",
      remaining_quantity: "1",
      delivery_basis: "estimate",
      final_quantity: "1",
    } as InvoiceLineItem;
    const totals = finalInvoiceTotals([seed], form([seed]));
    expect(totals).toMatchObject({ net: 1000, vat: 0, gross: 1000 });
  });
});
