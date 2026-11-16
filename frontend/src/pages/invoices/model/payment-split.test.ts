import { describe, expect, it } from "vitest";

import { parseMoneyInput } from "@/lib/money";

import {
  paymentSplitOffered,
  paymentSplitPayload,
  paymentSplitProblem,
  paymentSplitSummary,
  proRataSplit,
} from "./payment-split";
import type { AdvanceCategory } from "./types";

const categories: AdvanceCategory[] = [
  { kind: "taxed", vat_rate: "19", gross: "119", paid_gross: "0", open_gross: "119" },
  { kind: "zero_rated", vat_rate: "0", gross: "550", paid_gross: "0", open_gross: "550" },
  { kind: "passthrough", vat_rate: "0", gross: "300", paid_gross: "0", open_gross: "300" },
];

describe("payment split of an advance (owner 2026-11-15)", () => {
  it("is offered for a part payment only", () => {
    expect(paymentSplitOffered(categories, 669)).toBe(true);
    expect(paymentSplitOffered(categories, 969)).toBe(false);
    expect(paymentSplitOffered(categories, 0)).toBe(false);
    expect(paymentSplitOffered([categories[0]], 50)).toBe(false);
  });

  it("prefills pro rata and adds up to the payment", () => {
    const values = proRataSplit(categories, 669);
    expect(Object.values(values).every((value) => value.includes(","))).toBe(true);
    const sum = Object.values(values).reduce((total, value) => total + parseMoneyInput(value), 0);
    expect(Math.round(sum * 100)).toBe(66900);
    expect(paymentSplitProblem(categories, 669, values, "ru")).toBeNull();
  });

  it("names the first problem in one sentence", () => {
    expect(paymentSplitProblem(categories, 669, { "taxed:19": "119", "zero_rated:0": "550" }, "ru")).toBeNull();
    expect(paymentSplitProblem(categories, 669, { "taxed:19": "200", "zero_rated:0": "469" }, "de"))
      .toBe("Ein Anteil ist größer als der offene Betrag seiner Kategorie.");
    expect(paymentSplitProblem(categories, 669, { "taxed:19": "119" }, "ru"))
      .toBe("Сумма долей не равна сумме платежа.");
  });

  it("shows a recorded split in one short line", () => {
    expect(paymentSplitSummary([
      { kind: "taxed", vat_rate: "19", amount_gross: "50.00" },
      { kind: "zero_rated", vat_rate: "0", amount_gross: "150.00" },
      { kind: "passthrough", vat_rate: "0", amount_gross: "0.00" },
    ], "ru", "EUR")).toBe("19 % 50,00 € · 0 % 150,00 €");
    expect(paymentSplitSummary(null, "ru")).toBeNull();
  });

  it("reads the German money format with thousands", () => {
    const large: AdvanceCategory[] = [
      { kind: "taxed", vat_rate: "19", gross: "2000", paid_gross: "0", open_gross: "2000" },
      { kind: "passthrough", vat_rate: "0", gross: "3000", paid_gross: "0", open_gross: "3000" },
    ];
    expect(paymentSplitProblem(large, 3000, { "taxed:19": "1.234,56", "passthrough:0": "1.765,44" }, "ru")).toBeNull();
    expect(paymentSplitPayload(large, { "taxed:19": "1.234,56", "passthrough:0": "1.765,44" })).toEqual([
      { kind: "taxed", vat_rate: "19", amount_gross: "1234.56" },
      { kind: "passthrough", vat_rate: "0", amount_gross: "1765.44" },
    ]);
    expect(paymentSplitProblem(large, 3000, { "taxed:19": "12,345", "passthrough:0": "0" }, "ru"))
      .toBe("Доля указана неверно.");
  });

  it("sends kind, rate and amount per open category", () => {
    expect(paymentSplitPayload(categories, { "taxed:19": "119", "zero_rated:0": "550,00" })).toEqual([
      { kind: "taxed", vat_rate: "19", amount_gross: "119.00" },
      { kind: "zero_rated", vat_rate: "0", amount_gross: "550.00" },
      { kind: "passthrough", vat_rate: "0", amount_gross: "0.00" },
    ]);
  });
});
