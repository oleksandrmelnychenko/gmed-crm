import { describe, expect, it } from "vitest";

import { moneyLineAmounts, roundCents, sameCents, toCents } from "./money";

describe("commercial money rounding", () => {
  it("rounds cent midpoints up for positive amounts", () => {
    expect(roundCents(45.125)).toBe(45.13);
    expect(roundCents(0.005)).toBe(0.01);
    expect(roundCents(2.345)).toBe(2.35);
    expect(roundCents(2.335)).toBe(2.34);
    expect(roundCents(1.004999)).toBe(1);
  });

  it("rounds negative midpoints away from zero", () => {
    expect(roundCents(-45.125)).toBe(-45.13);
    expect(roundCents(-0.005)).toBe(-0.01);
    expect(roundCents(-2.345)).toBe(-2.35);
    expect(Object.is(roundCents(-0.004), 0)).toBe(true);
  });

  it("ignores binary floating point noise at a decimal tie", () => {
    // 1.005 and 2.675 are stored as 1.00499… and 2.67499….
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(2.675)).toBe(2.68);
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
  });

  it("compares amounts in whole cents", () => {
    expect(toCents(282.63)).toBe(28263);
    expect(toCents(-45.125)).toBe(-4513);
    expect(Number.isNaN(toCents(Number.NaN))).toBe(true);
    expect(sameCents(282.625, 282.63)).toBe(true);
    expect(sameCents(282.62, 282.63)).toBe(false);
  });

  it("gives 282.63 gross for 2.5 h at 95 EUR with 19 % VAT, like the server quote", () => {
    expect(moneyLineAmounts(2.5, 95, 19)).toEqual({ net: 237.5, vat: 45.13, gross: 282.63 });
  });

  it("rounds the 0.5 h and 4.5 h VAT midpoints up as well", () => {
    expect(moneyLineAmounts(0.5, 95, 19)).toEqual({ net: 47.5, vat: 9.03, gross: 56.53 });
    expect(moneyLineAmounts(4.5, 95, 19)).toEqual({ net: 427.5, vat: 81.23, gross: 508.73 });
  });

  it("mirrors negative (credit) lines", () => {
    expect(moneyLineAmounts(-2.5, 95, 19)).toEqual({ net: -237.5, vat: -45.13, gross: -282.63 });
  });
});
