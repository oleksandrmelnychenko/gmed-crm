import { describe, expect, it } from "vitest";
import { applyInvoiceVatCalculation, calculateInvoiceAmounts, defaultInvoiceVatCalculation, validInvoiceVatRate } from "./import-amounts";
import { blankImportFields, importTotalsMatch } from "./import-model";

describe("incoming invoice VAT calculation", () => {
  it.each([
    ["100", "19", "amount_net", "100.00", "19.00", "119.00"],
    ["119", "19", "amount_gross", "100.00", "19.00", "119.00"],
    ["119", "7", "amount_gross", "111.21", "7.79", "119.00"],
    ["10,50", "0", "amount_net", "10.50", "0.00", "10.50"],
    ["10.50", "0", "amount_gross", "10.50", "0.00", "10.50"],
    ["100", "8,1", "amount_net", "100.00", "8.10", "108.10"],
    ["108.10", "8.1", "amount_gross", "100.00", "8.10", "108.10"],
    ["10000", "7.1234", "amount_net", "10000.00", "712.34", "10712.34"],
    ["0.50", "19", "amount_net", "0.50", "0.10", "0.60"],
    ["0.03", "100", "amount_gross", "0.02", "0.01", "0.03"],
    ["0", "19", "amount_gross", "0.00", "0.00", "0.00"],
    ["999999999999.99", "19", "amount_gross", "840336134453.77", "159663865546.22", "999999999999.99"],
  ] as const)("calculates %s at %s%% from %s with cent rounding", (value, rate, base, net, vat, gross) => {
    const amounts = calculateInvoiceAmounts(value, rate, base);
    expect(amounts).toEqual({ amount_net: net, amount_vat: vat, amount_gross: gross });
    expect(importTotalsMatch({ ...blankImportFields(), ...amounts })).toBe(true);
  });

  it("rejects invalid rates, unfinished amounts and overflow instead of using stale totals", () => {
    for (const rate of ["", "-19", "101", "100.0001", "19%", "1e1", "7.12345", "NaN"]) {
      expect(validInvoiceVatRate(rate)).toBe(false);
      expect(calculateInvoiceAmounts("100", rate, "amount_net")).toBeNull();
    }
    for (const value of ["", "12,", "-5", "0.001", "1.000,00"]) {
      expect(calculateInvoiceAmounts(value, "19", "amount_net")).toBeNull();
    }
    expect(calculateInvoiceAmounts("999999999999.99", "19", "amount_net")).toBeNull();
    const fields = { ...blankImportFields(), amount_net: "12,", amount_vat: "19", amount_gross: "119" };
    expect(applyInvoiceVatCalculation(fields, { selection: "19", customRate: "", base: "amount_net" }))
      .toMatchObject({ amount_net: "12,", amount_vat: "", amount_gross: "" });
  });

  it("keeps original mixed-tax amounts in manual mode and preserves edited input in calculation mode", () => {
    const fields = { ...blankImportFields(), amount_net: "200,00", amount_vat: "26", amount_gross: "226", currency: "CHF", supplier_name: "Shop" };
    expect(applyInvoiceVatCalculation(fields, defaultInvoiceVatCalculation())).toBe(fields);
    expect(applyInvoiceVatCalculation(fields, { selection: "custom", customRate: "8.1", base: "amount_net" }))
      .toEqual({ ...fields, amount_vat: "16.20", amount_gross: "216.20" });
  });
});
