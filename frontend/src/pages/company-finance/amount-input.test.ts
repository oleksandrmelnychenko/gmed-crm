import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import { amountInputText, amountInputValue, normalizeAmountInput } from "./amount-input";
import { localizeCompanyFinanceError } from "./errors";

describe("company-finance amount input (QA D3-02)", () => {
  it("sends German decimals in the API form", () => {
    expect(normalizeAmountInput("119,00")).toBe("119.00");
    expect(normalizeAmountInput("1.234,56")).toBe("1234.56");
    expect(normalizeAmountInput(" 1 234,5 ")).toBe("1234.5");
    expect(normalizeAmountInput("119.00")).toBe("119.00");
  });

  it("reads the typed amount as a number", () => {
    expect(amountInputValue("119,00")).toBe(119);
    expect(amountInputValue("1.234,56")).toBe(1234.56);
    expect(amountInputValue("")).toBeNaN();
    expect(amountInputValue("abc")).toBeNaN();
  });

  it("prefills an API amount the way staff type it", () => {
    expect(amountInputText("119")).toBe("119,00");
    expect(amountInputText("1234.5")).toBe("1234,50");
    expect(amountInputText("")).toBe("");
    expect(amountInputText(null)).toBe("");
  });

  it("translates the payout refusals instead of showing English texts", () => {
    const invalid = new ApiRequestError("Invalid amount", {
      status: 422,
      code: "Invalid amount",
      body: { error: "Invalid amount" },
    });
    expect(localizeCompanyFinanceError(invalid, "ru", "x")).toBe("Введите корректную сумму.");
    expect(localizeCompanyFinanceError(invalid, "de", "x")).toBe("Bitte einen gültigen Betrag eingeben.");

    const exceeds = new ApiRequestError("Provider payment exceeds the outstanding amount", {
      status: 409,
      code: "Provider payment exceeds the outstanding amount",
      body: { error: "Provider payment exceeds the outstanding amount" },
    });
    expect(localizeCompanyFinanceError(exceeds, "ru", "x")).toBe(
      "Сумма больше, чем осталось выплатить по счёту.",
    );
  });
});
