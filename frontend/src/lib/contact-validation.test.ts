import { describe, expect, it } from "vitest";

import { isValidEmailAddress } from "./contact-validation";

describe("isValidEmailAddress", () => {
  it.each([
    "max.muster@example.de",
    " Anna+x@mail.example.co.uk ",
    "test@example.invalid",
    "x@xn--80ak6aa92e.xn--p1ai",
  ])("accepts %j", (value) => {
    expect(isValidEmailAddress(value)).toBe(true);
  });

  it.each([
    "",
    "asdf",
    "max@example",
    "max@example.d",
    "a@b.c",
    "max@@example.de",
    "max muster@example.de",
    ".max@example.de",
    "ma..x@example.de",
    "max@-example.de",
    "макс@пример.рф",
    "max@example.123",
  ])("rejects %j", (value) => {
    expect(isValidEmailAddress(value)).toBe(false);
  });
});
