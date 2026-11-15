import { describe, expect, it } from "vitest";

import {
  paymentSplitOffered,
  paymentSplitPayload,
  paymentSplitProblem,
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
    const sum = Object.values(values).reduce((total, value) => total + Number(value), 0);
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

  it("sends kind, rate and amount per open category", () => {
    expect(paymentSplitPayload(categories, { "taxed:19": "119", "zero_rated:0": "550,00" })).toEqual([
      { kind: "taxed", vat_rate: "19", amount_gross: "119.00" },
      { kind: "zero_rated", vat_rate: "0", amount_gross: "550.00" },
      { kind: "passthrough", vat_rate: "0", amount_gross: "0.00" },
    ]);
  });
});
