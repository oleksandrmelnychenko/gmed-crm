import { describe, expect, it } from "vitest";

import {
  calculateInvoiceSelectionTotals,
  invoiceLineQuantityAvailable,
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
