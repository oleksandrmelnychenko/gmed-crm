import { describe, expect, it } from "vitest";

import {
  formatMoneyLabel,
  formatMoneyRange,
  formatRecognizedMoney,
  moneyInputMessage,
  moneyInputPayload,
  moneyInputProblem,
  moneyInputText,
  moneyFinalLinePartAmounts,
  moneyLineAmounts,
  moneyLineDiscount,
  moneyLinePartAmounts,
  normalizeMoneyInput,
  parseDiscountPercent,
  parseMoneyInput,
  roundCents,
  sameCents,
  toCents,
} from "./money";

// Owner 2026-11-11: German money format in every money field.
describe("money fields: German format everywhere", () => {
  it("reads German thousands dots with comma decimals", () => {
    expect(parseMoneyInput("1.234,56")).toBe(1234.56);
    expect(parseMoneyInput("12.345.678,90")).toBe(12345678.9);
    expect(parseMoneyInput("1.500")).toBe(1500);
    expect(moneyInputPayload("1.234,56")).toBe("1234.56");
  });

  it("reads comma decimals without thousands dots", () => {
    expect(parseMoneyInput("1234,56")).toBe(1234.56);
    expect(parseMoneyInput("119,5")).toBe(119.5);
    expect(moneyInputPayload(" 1 234,50 ")).toBe("1234.50");
  });

  it("reads plain dot decimals as the old number fields sent them", () => {
    expect(parseMoneyInput("1234.56")).toBe(1234.56);
    expect(parseMoneyInput("0.01")).toBe(0.01);
    expect(moneyInputPayload("119.00")).toBe("119.00");
  });

  it("names an unreadable amount instead of calling it zero", () => {
    for (const value of ["abc", "1,500", "1.234.5", "12,345", "1e3", "1400,009999999,99", "1,234.56"]) {
      expect(moneyInputProblem(value)).toBe("unreadable");
      expect(moneyInputPayload(value)).toBeNull();
    }
    expect(moneyInputMessage("unreadable", "ru")).toBe("Введите сумму числом, например 119,00 или 1.234,56.");
    expect(moneyInputMessage("unreadable", "de")).toBe("Bitte den Betrag als Zahl eingeben, z. B. 119,00 oder 1.234,56.");
  });

  it("refuses zero and negative amounts where the field does not allow them", () => {
    expect(moneyInputProblem("")).toBeNull();
    expect(moneyInputProblem("0")).toBe("not_positive");
    expect(moneyInputProblem("0,00", { allowZero: true })).toBeNull();
    expect(moneyInputProblem("-5")).toBe("not_positive");
    expect(moneyInputProblem("-5", { allowZero: true })).toBe("negative");
    expect(moneyInputProblem("-1.500,50", { allowNegative: true })).toBeNull();
    expect(moneyInputProblem("119,00")).toBeNull();
    expect(moneyInputMessage("not_positive", "ru")).toBe("Введите сумму больше нуля, например 119,00.");
  });
});

describe("typed money amounts (QA 2026-10-31)", () => {
  it("reads German amounts and the plain API form", () => {
    expect(normalizeMoneyInput("119,5")).toBe("119.5");
    expect(normalizeMoneyInput("1.234,56")).toBe("1234.56");
    expect(normalizeMoneyInput(" 1 234,5 ")).toBe("1234.5");
    expect(normalizeMoneyInput("1234.56")).toBe("1234.56");
    expect(normalizeMoneyInput("1500")).toBe("1500");
    expect(normalizeMoneyInput("-12,50")).toBe("-12.50");
  });

  it("reads a dot before three digits as thousands, never as 1,50", () => {
    expect(normalizeMoneyInput("1.500")).toBe("1500");
    expect(normalizeMoneyInput("12.345.678")).toBe("12345678");
    expect(parseMoneyInput("1.500")).toBe(1500);
  });

  it("refuses what it would have to guess", () => {
    for (const value of ["", "abc", "1,500", "1.2.3", "12.3456", "1.50.000", "1.234,567", "0.004"]) {
      expect(normalizeMoneyInput(value), value).toBeNull();
      expect(parseMoneyInput(value), value).toBeNaN();
    }
  });
});

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

  it("takes the VAT from the discounted net, like the server (owner 2026-11-18)", () => {
    expect(moneyLineDiscount(2, 180, 10)).toBe(36);
    expect(moneyLineAmounts(2, 180, 19, 10)).toEqual({ net: 324, vat: 61.56, gross: 385.56 });
    expect(moneyLineAmounts(3, 33.33, 19, 33.33)).toEqual({ net: 66.66, vat: 12.67, gross: 79.33 });
    expect(moneyLineAmounts(2.5, 95, 19, 15)).toEqual({ net: 201.87, vat: 38.36, gross: 240.23 });
    expect(moneyLineAmounts(2.5, 95, 19, 0)).toEqual(moneyLineAmounts(2.5, 95, 19));
    expect(moneyLineAmounts(2.5, 95, 19, 100)).toEqual({ net: 0, vat: 0, gross: 0 });
  });

  it("prices parts of a discounted line like the server", () => {
    const line = moneyLineAmounts(3, 33.33, 19, 33.33);
    const first = moneyLinePartAmounts({ quantity: 1, unitPriceNet: 33.33, vatRatePercent: 19, discountPercent: 33.33,
      lineQuantity: 3, billedQuantity: 0, lineNet: line.net, lineGross: line.gross, billedNet: 0, billedGross: 0 });
    expect(first).toEqual({ net: 22.22, vat: 4.22, gross: 26.44 });
    const last = moneyLinePartAmounts({ quantity: 2, unitPriceNet: 33.33, vatRatePercent: 19, discountPercent: 33.33,
      lineQuantity: 3, billedQuantity: 1, lineNet: line.net, lineGross: line.gross, billedNet: first.net, billedGross: first.gross });
    // The nets add up to the line; each part's VAT is its own (QA 2026-11-19).
    expect(roundCents(first.net + last.net)).toBe(line.net);
    expect(last).toEqual({ net: 44.44, vat: 8.44, gross: 52.88 });
    // 6 h × 95,00 at 10 %: the second 3 h are 256,50 + 48,74, not the rest 48,73.
    const hours = moneyLineAmounts(6, 95, 19, 10);
    const interim = moneyLineAmounts(3, 95, 19, 10);
    expect(moneyLinePartAmounts({ quantity: 3, unitPriceNet: 95, vatRatePercent: 19, discountPercent: 10,
      lineQuantity: 6, billedQuantity: 3, lineNet: hours.net, lineGross: hours.gross, billedNet: interim.net, billedGross: interim.gross }))
      .toEqual({ net: 256.5, vat: 48.74, gross: 305.24 });
    const quoted = moneyLineAmounts(3, 60, 19, 10);
    expect(moneyFinalLinePartAmounts({ quantity: 5, unitPriceNet: 60, vatRatePercent: 19, discountPercent: 10,
      lineQuantity: 3, billedQuantity: 0, lineNet: quoted.net, lineGross: quoted.gross, billedNet: 0, billedGross: 0 }))
      .toEqual({ net: 270, vat: 51.3, gross: 321.3 });
  });

  it("reads a discount of 0 to 100 % with two decimals", () => {
    expect(parseDiscountPercent("")).toBe(0);
    expect(parseDiscountPercent("10")).toBe(10);
    expect(parseDiscountPercent("12,5")).toBe(12.5);
    expect(parseDiscountPercent("100")).toBe(100);
    expect(parseDiscountPercent("100.01")).toBeNull();
    expect(parseDiscountPercent("-1")).toBeNull();
    expect(parseDiscountPercent("33.333")).toBeNull();
    expect(parseDiscountPercent("abc")).toBeNull();
  });

  it("mirrors negative (credit) lines", () => {
    expect(moneyLineAmounts(-2.5, 95, 19)).toEqual({ net: -237.5, vat: -45.13, gross: -282.63 });
  });
});

// The owner money format: "1.234,56 €" in every UI language; U+00A0 before the sign.
describe("money labels", () => {
  it("writes euros with the euro sign and keeps another currency code", () => {
    expect(formatMoneyLabel(1234.5)).toBe("1.234,50\u00a0€");
    expect(formatMoneyLabel("6000", "EUR")).toBe("6.000,00\u00a0€");
    expect(formatMoneyLabel("99,9", "eur")).toBe("99,90\u00a0€");
    expect(formatMoneyLabel(1234.5, "USD")).toBe("1.234,50\u00a0USD");
  });

  it("writes a range with the currency once", () => {
    expect(formatMoneyRange(250, 1000)).toBe("250,00 – 1.000,00\u00a0€");
    expect(formatMoneyRange("12500", "15000", "CHF")).toBe("12.500,00 – 15.000,00\u00a0CHF");
  });

  it("writes an amount read from a document, keeping up to four decimals", () => {
    expect(formatRecognizedMoney("8.50", "EUR")).toBe("8,50\u00a0€");
    expect(formatRecognizedMoney("0.1234", "EUR")).toBe("0,1234\u00a0€");
    expect(formatRecognizedMoney("1190", "USD")).toBe("1.190,00\u00a0USD");
    expect(formatRecognizedMoney("n/a", "EUR")).toBe("n/a EUR");
    expect(formatRecognizedMoney(null, "EUR")).toBe("");
  });
});

describe("moneyInputText", () => {
  it("shows a stored amount as staff type it (QA 2026-11-01, U-6)", () => {
    expect(moneyInputText("87.40")).toBe("87,40");
    expect(moneyInputText("87.4000")).toBe("87,40");
    expect(moneyInputText(1234.5)).toBe("1234,50");
    expect(normalizeMoneyInput(moneyInputText("1234.50"))).toBe("1234.50");
    expect(moneyInputText(null)).toBe("");
    expect(moneyInputText("")).toBe("");
  });
});
