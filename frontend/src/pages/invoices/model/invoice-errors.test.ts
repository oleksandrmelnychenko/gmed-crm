import { describe, expect, it } from "vitest";

import {
  invoiceConfirmationField,
  invoiceReleaseWarningText,
  localizeInvoiceError,
} from "./invoice-errors";

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

  it("maps release checks by code and names the missing address parts", () => {
    const incomplete = {
      code: "recipient_address_incomplete",
      body: { error: "recipient_address_incomplete", missing: ["zip", "country"] },
      message: "The invoice recipient needs a full name and postal address with country before release",
    };
    expect(localizeInvoiceError(incomplete, "de", "x")).toBe(
      "Für die Ausstellung fehlen Name oder vollständige Anschrift des Rechnungsempfängers (Straße, PLZ, Ort, Land). Es fehlt: PLZ, Land.",
    );
    expect(localizeInvoiceError(incomplete, "ru", "x")).toContain("Не хватает: индекс, страна.");
    expect(invoiceConfirmationField(incomplete)).toBeNull();

    const minor = {
      code: "minor_patient_recipient",
      body: { error: "minor_patient_recipient", confirm_field: "confirm_minor_recipient" },
    };
    expect(localizeInvoiceError(minor, "ru", "x")).toContain("несовершеннолетнему");
    expect(invoiceConfirmationField(minor)).toBe("confirm_minor_recipient");
    expect(
      invoiceConfirmationField({ body: { confirm_field: "drop table" } }),
    ).toBeNull();
    expect(
      localizeInvoiceError(
        { code: "recipient_not_contracting_party", body: { confirm_field: "confirm_recipient_not_party" } },
        "de",
        "x",
      ),
    ).toContain("Kostenübernehmer");
    expect(
      invoiceReleaseWarningText({ code: "advance_recipient_mismatch" }, "ru"),
    ).toContain("авансы того же получателя");
    expect(
      localizeInvoiceError({ code: "payer_email_invalid", body: {} }, "de", "x"),
    ).toBe("Die E-Mail-Adresse des Zahlers ist ungültig.");
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
