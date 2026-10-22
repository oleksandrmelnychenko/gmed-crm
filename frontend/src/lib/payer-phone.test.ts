import { describe, expect, it } from "vitest";

import { isValidPayerPhone, payerPhoneAcceptable } from "./payer-phone";

describe("payer phone rule (owner 2026-10-22)", () => {
  it("needs six digits and only + ( ) - / and spaces besides them", () => {
    for (const valid of ["+49 30 1234567", "+49 (151) 123-456", "030/123456", " 0151123456 "]) {
      expect(isValidPayerPhone(valid), valid).toBe(true);
    }
    for (const invalid of ["", "abc", "+49 12", "12345", "call me 123456", "+49.30.123456"]) {
      expect(isValidPayerPhone(invalid), invalid).toBe(false);
    }
  });

  it("checks only a new or changed number", () => {
    expect(payerPhoneAcceptable("", "x")).toBe(true);
    expect(payerPhoneAcceptable("12345", "12345")).toBe(true);
    expect(payerPhoneAcceptable("12345", null)).toBe(false);
    expect(payerPhoneAcceptable("+49 30 123456", "12345")).toBe(true);
  });
});
