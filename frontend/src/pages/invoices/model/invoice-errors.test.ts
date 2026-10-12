import { describe, expect, it } from "vitest";

import {
  invoiceConfirmationField,
  invoiceReleaseWarningText,
  localizeInvoiceError,
} from "./invoice-errors";

describe("money-relevant confirmations and refusals name their facts", () => {
  it("names the advances of another recipient a final invoice settles (QA D2-03)", () => {
    const advances = [
      {
        invoice_number: "INV-20261012-0005",
        recipient_name: "Ben Muster",
        total_gross: "214.2",
        paid_gross: "214.2",
        open_gross: "214.2",
      },
    ];
    const refused = {
      code: "advance_recipient_mismatch",
      body: {
        error: "advance_recipient_mismatch",
        confirm_field: "confirm_advance_recipient_mismatch",
        details: { advance_invoice_numbers: ["INV-20261012-0005"], advances },
      },
    };
    const ru = localizeInvoiceError(refused, "ru", "x");
    expect(ru).toContain("INV-20261012-0005");
    expect(ru).toContain("Ben Muster");
    expect(ru).toMatch(/оплачено 214,20\s€/);
    expect(localizeInvoiceError(refused, "de", "x")).toContain("Empfänger: Ben Muster");
    expect(
      invoiceReleaseWarningText({ code: "advance_recipient_mismatch", advances }, "ru"),
    ).toContain("Затронутые авансы: INV-20261012-0005");
  });

  it("says until when the previous dunning letter runs (QA D2-06)", () => {
    const refused = {
      code: "dunning_previous_deadline_running",
      body: {
        error: "dunning_previous_deadline_running",
        previous_level: "first",
        payment_due_date: "2026-10-26",
        override_allowed: false,
      },
    };
    const ru = localizeInvoiceError(refused, "ru", "x");
    expect(ru).toContain("26.10.2026");
    expect(ru).not.toContain("CEO");
    expect(
      localizeInvoiceError({ ...refused, body: { ...refused.body, override_allowed: true } }, "de", "x"),
    ).toContain("Als CEO");
  });

  it("refuses correction documents without GMED's tax registration in the UI language (QA D2-09)", () => {
    const refused = { code: "issuer_tax_registration_missing", body: { error: "issuer_tax_registration_missing" } };
    expect(localizeInvoiceError(refused, "ru", "x")).toContain("документ корректировки");
    expect(localizeInvoiceError(refused, "de", "x")).toContain("Rechnungskorrektur");
  });
});

describe("localizeInvoiceError", () => {
  it("points to the system settings when GMED's tax number is missing", () => {
    const error = Object.assign(
      new Error("GMED's tax number or VAT ID is missing; set it in the system settings before releasing invoices"),
      { code: "issuer_tax_registration_missing", body: { error: "issuer_tax_registration_missing" } },
    );
    expect(localizeInvoiceError(error, "ru", "Ошибка")).toContain("Системных настройках");
    expect(localizeInvoiceError(error, "de", "Fehler")).toContain("Systemeinstellungen");
    expect(
      invoiceReleaseWarningText({ code: "issuer_tax_registration_missing" }, "ru"),
    ).toContain("Steuernummer");
  });

  it("names the cash left when a refund would take the Kasse below zero", () => {
    const error = Object.assign(new Error("A cash account cannot go below zero"), {
      code: "cash_account_insufficient_balance",
      body: { error: "cash_account_insufficient_balance", available_balance: "30" },
    });
    const ru = localizeInvoiceError(error, "ru", "Ошибка");
    expect(ru).toContain("Касса");
    expect(ru).toContain("30,00");
    expect(localizeInvoiceError(error, "de", "Fehler")).toContain("Kasse");
  });

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

  it("explains why the positions of a released invoice are locked and how long a remark may be", () => {
    const locked = new Error(
      "The positions of a released invoice cannot change; cancel the invoice and issue a new one",
    );
    expect(localizeInvoiceError(locked, "ru", "Ошибка")).toContain("Позиции выпущенного счёта");
    expect(localizeInvoiceError(locked, "de", "Fehler")).toContain("Positionen einer ausgestellten Rechnung");
    const tooLong = new Error("Invoice line comment is too long");
    expect(localizeInvoiceError(tooLong, "ru", "Ошибка")).toContain("300");
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
    ).toContain("закрывает именно эти авансы");
    expect(
      invoiceReleaseWarningText({ code: "services_not_delivered" }, "de"),
    ).toContain("Leistung noch nicht erbracht");
    expect(
      localizeInvoiceError({ code: "payer_email_invalid", body: {} }, "de", "x"),
    ).toBe("Die E-Mail-Adresse des Zahlers ist ungültig.");
  });

  it("translates payment and credit-note refusals instead of showing English (QA D-07, D-63)", () => {
    const overpaid = {
      code: "payment_exceeds_balance",
      body: {
        error: "payment_exceeds_balance",
        message:
          "Payment exceeds invoice balance; confirm the overpayment to record the excess as patient credit",
      },
    };
    expect(localizeInvoiceError(overpaid, "ru", "x")).toContain("переплату пациента");
    expect(
      localizeInvoiceError(new Error("Credit note violates invoice balance rules"), "de", "x"),
    ).toContain("Gutschrift");
    expect(
      localizeInvoiceError({ body: { error: "credit_note_below_applied_advance" } }, "ru", "x"),
    ).toContain("зачтён в финальный счёт");
    expect(
      localizeInvoiceError(
        { body: { error: "prepayment_recipient_mismatch", confirm_field: "confirm_recipient_mismatch" } },
        "ru",
        "x",
      ),
    ).toContain("другому получателю");
    expect(localizeInvoiceError(new Error("Refund exceeds the refundable cash credit"), "ru", "x")).toBe(
      "Сумма возврата больше доступной к возврату переплаты.",
    );
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
