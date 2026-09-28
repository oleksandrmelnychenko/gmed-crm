import { describe, expect, it } from "vitest";

import { localizeInvoiceError } from "./invoice-errors";

describe("localizeInvoiceError", () => {
  it("says a credit note was already reversed in the UI language", () => {
    const error = new Error("Credit note was already reversed");
    expect(localizeInvoiceError(error, "ru", "Ошибка")).toBe("Эта кредит-нота уже сторнирована.");
    expect(localizeInvoiceError(error, "de", "Fehler")).toBe(
      "Diese Gutschrift wurde bereits storniert.",
    );
  });

  it("explains why the payer of a released invoice is locked", () => {
    const error = new Error(
      "The payer of a released invoice cannot change; cancel the invoice and issue a new one",
    );
    expect(localizeInvoiceError(error, "ru", "Ошибка")).toContain("Отмените счёт");
  });

  it("turns reload hints into a localized reload request", () => {
    expect(
      localizeInvoiceError(new Error("Invoice payment state changed; reload and try again"), "ru", "x"),
    ).toBe("Данные уже изменились. Обновите страницу и повторите действие.");
    expect(
      localizeInvoiceError(new Error("Invoice quantity changed; reload the quote and try again"), "de", "x"),
    ).toContain("neu laden");
  });

  it("keeps an unknown reason rather than hiding it, and falls back without one", () => {
    expect(localizeInvoiceError(new Error("Something specific"), "ru", "Ошибка")).toBe(
      "Something specific",
    );
    expect(localizeInvoiceError(undefined, "ru", "Ошибка")).toBe("Ошибка");
  });
});
