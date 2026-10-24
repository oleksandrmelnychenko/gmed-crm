import { describe, expect, it } from "vitest";

import { PERSON_CITY_MAX, PERSON_NAME_MAX, isAdultOn, isValidPersonPhone, oneLine, personPhoneAcceptable } from "./person-fields";

describe("the shared person fields (as services/person_fields.rs)", () => {
  it("takes a phone with six digits and the usual separators only", () => {
    for (const phone of ["+49 30 123456", "(030) 123-456", "030/123.456", " 0301234567 "]) {
      expect(isValidPersonPhone(phone), phone).toBe(true);
    }
    for (const phone of ["12345", "+49 123", "call 0301234567", "0301234567 ext", "1".repeat(41), ""]) {
      expect(isValidPersonPhone(phone), phone).toBe(false);
    }
  });

  it("keeps a stored phone acceptable and checks a changed one", () => {
    expect(personPhoneAcceptable("12", "12")).toBe(true);
    expect(personPhoneAcceptable("", "12")).toBe(true);
    expect(personPhoneAcceptable("123", "12")).toBe(false);
  });

  it("puts names on one line with the server's limits", () => {
    expect(oneLine("  Anna   Maria \t")).toBe("Anna Maria");
    expect(PERSON_NAME_MAX).toBe(100);
    expect(PERSON_CITY_MAX).toBe(120);
  });

  it("is of full age from the 18th birthday on", () => {
    expect(isAdultOn("2008-10-24", "2026-10-24")).toBe(true);
    expect(isAdultOn("2008-10-25", "2026-10-24")).toBe(false);
    expect(isAdultOn("2015-03-02", "2026-10-24")).toBe(false);
    expect(isAdultOn("", "2026-10-24")).toBe(true);
  });
});
