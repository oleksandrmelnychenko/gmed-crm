import { describe, expect, it } from "vitest";

import {
  calculateInvoiceSelectionTotals,
  blankCreateForm,
  createInvoiceLineSelection,
  invoiceLineQuantityAvailable,
  isInvoiceSelectionValid,
} from "./invoice-model";
import type { InvoiceLineItem } from "./types";

function line(overrides: Partial<InvoiceLineItem> = {}): InvoiceLineItem {
  return {
    description: "Service",
    quantity: "2",
    unit_price: "100",
    vat_rate: "19",
    is_cost_passthrough: false,
    line_net: "200",
    line_vat: "38",
    line_gross: "238",
    ...overrides,
  };
}

describe("invoice creation totals", () => {
  it("shows net, VAT and gross for the actually selected quantities", () => {
    expect(
      calculateInvoiceSelectionTotals(
        [line(), line({ unit_price: "50", vat_rate: "7" })],
        [0, 1],
        { "0": "0.5", "1": "1" },
      ),
    ).toEqual({
      net: 100,
      vat: 13,
      gross: 113,
      lineGrossByIndex: { 0: 59.5, 1: 53.5 },
    });
  });

  it("uses the full quoted scope for an advance and the remaining scope for settlements", () => {
    const quoteLine = line({ quantity: "3", remaining_quantity: "1" });
    expect(invoiceLineQuantityAvailable(quoteLine, "advance")).toBe(3);
    expect(invoiceLineQuantityAvailable(quoteLine, "interim")).toBe(1);
    expect(invoiceLineQuantityAvailable(quoteLine, "final")).toBe(1);
  });
});

describe("invoice creation selection", () => {
  const lines = [line({ quantity: "3", remaining_quantity: "1" }), line({ remaining_quantity: "0" })];

  it("initializes final invoices with only the remaining quantities", () => {
    expect(createInvoiceLineSelection(lines, "final")).toEqual({
      selectedLineIndexes: [0], lineQuantities: { "0": "1", "1": "0" },
    });
    expect(createInvoiceLineSelection(lines, "advance")).toEqual({
      selectedLineIndexes: [0, 1], lineQuantities: { "0": "3", "1": "2" },
    });
  });

  it.each(["", "0", "-1", "1.01", "NaN", "Infinity"])("rejects an invalid selected quantity: %s", (quantity) => {
    expect(isInvoiceSelectionValid(lines, {
      ...blankCreateForm("quote"), invoiceType: "interim", selectedLineIndexes: [0], lineQuantities: { "0": quantity },
    })).toBe(false);
  });

  it("allows partial interim quantities but requires the full remainder for final invoices", () => {
    const form = { ...blankCreateForm("quote"), selectedLineIndexes: [0], lineQuantities: { "0": "0.5" } };
    expect(isInvoiceSelectionValid(lines, { ...form, invoiceType: "interim" })).toBe(true);
    expect(isInvoiceSelectionValid(lines, form)).toBe(false);
    expect(isInvoiceSelectionValid(lines, { ...form, lineQuantities: { "0": "1" } })).toBe(true);
  });

  it("rejects a final invoice missing a remaining line", () => {
    expect(isInvoiceSelectionValid([line(), line()], {
      ...blankCreateForm("quote"), selectedLineIndexes: [0], lineQuantities: { "0": "2" },
    })).toBe(false);
  });

  it("rejects unavailable, duplicate and nonexistent selections", () => {
    for (const selectedLineIndexes of [[], [1], [0, 0], [5]]) {
      expect(isInvoiceSelectionValid(lines, {
        ...blankCreateForm("quote"), invoiceType: "interim", selectedLineIndexes,
        lineQuantities: { "0": "1", "1": "1", "5": "1" },
      })).toBe(false);
    }
  });
});
