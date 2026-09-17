import { describe, expect, it } from "vitest";

import { zugferdErrorMessage } from "./zugferd";

describe("zugferdErrorMessage", () => {
  it("names the missing mandatory fields", () => {
    const error = new Error("E-invoice is missing mandatory data: seller_tax_registration, buyer_country");
    expect(zugferdErrorMessage(error, "de", "x")).toContain("USt-IdNr. oder Steuernummer der Agentur, Land in der Patientenadresse");
    expect(zugferdErrorMessage(error, "ru", "x")).toContain("страна в адресе пациента");
  });

  it("passes other errors through", () => {
    expect(zugferdErrorMessage(new Error("Invoice not found"), "de", "x")).toBe("Invoice not found");
    expect(zugferdErrorMessage(null, "de", "fallback")).toBe("fallback");
  });
});
