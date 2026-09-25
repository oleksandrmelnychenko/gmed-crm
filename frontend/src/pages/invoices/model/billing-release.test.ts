import { describe, expect, it } from "vitest";
import { invoiceCreationErrorMessage } from "./billing-release";

// Every `error` text POST /quotes/{id}/invoices can answer with
// (crates/server/src/routes/invoices.rs, create_invoice_from_quote and its helpers).
const SERVER_MESSAGES = [
  "Insufficient permissions",
  "Quote not found",
  "Failed to load quote",
  "Failed to validate patient access",
  "Invalid invoice type",
  "Invalid date (YYYY-MM-DD)",
  "Quote has no invoiceable line items",
  "Failed to load remaining invoice quantities",
  "At least one invoice line must be selected",
  "Selected invoice line does not exist",
  "Invalid invoice line quantity",
  "Invoice line quantity must be greater than zero",
  "Invoice line was selected more than once",
  "Quote contains an invalid line quantity",
  "A service cancelled by contract termination cannot be invoiced",
  "Selected quantity exceeds the remaining quote line quantity",
  "Quote contains invalid price or VAT data",
  "A final invoice must include every remaining quote line quantity",
  "A selected quote line has already been fully invoiced",
  "This quote has no remaining quantities to invoice",
  "Failed to load approved package overages",
  "Approved package overage is missing a charge price",
  "Cannot invoice a rejected or expired quote",
  "Failed to validate invoice duplication",
  "An active invoice already exists for this quote scope",
  "Failed to create invoice",
  "Invoice quantity changed; reload the quote and try again",
  "Failed to save invoice line allocation",
  "Order services changed; reload and try again",
  "Failed to mark order services as invoiced",
  "Failed to link package consumption to invoice",
  "The order behind this quote is still a draft or was cancelled; confirm the order preparation before invoicing",
];

describe("invoice creation errors", () => {
  it("explains server rejections in the selected language", () => {
    const message = "Cannot invoice a rejected or expired quote";
    expect(invoiceCreationErrorMessage(new Error(message), "ru", "Ошибка")).toContain("отклонённому");
    expect(invoiceCreationErrorMessage(new Error(message), "de", "Fehler")).toContain("abgelehntes");
  });

  it.each(SERVER_MESSAGES)("never shows the raw server text %j", (message) => {
    const ru = invoiceCreationErrorMessage(new Error(message), "ru", "Ошибка");
    const de = invoiceCreationErrorMessage(new Error(message), "de", "Fehler");
    expect(ru).not.toBe(message);
    expect(ru).toMatch(/[А-Яа-яЁё]/);
    expect(de).not.toBe(message);
    expect(de).not.toBe(ru);
  });

  it("tells the user to reload after a concurrent quantity or service change", () => {
    expect(invoiceCreationErrorMessage(new Error("Invoice quantity changed; reload the quote and try again"), "ru", "Ошибка"))
      .toBe("Доступный остаток изменился. Обновите предложение и проверьте количество.");
    expect(invoiceCreationErrorMessage(new Error("Order services changed; reload and try again"), "de", "Fehler"))
      .toBe("Die Leistungen des Auftrags haben sich geändert. Aktualisieren Sie die Daten und versuchen Sie es erneut.");
  });

  it("reports internal failures as a retryable creation failure", () => {
    expect(invoiceCreationErrorMessage(new Error("Failed to save invoice line allocation"), "ru", "Ошибка"))
      .toBe("Не удалось создать счёт. Повторите попытку.");
    expect(invoiceCreationErrorMessage(new Error("Failed to create invoice"), "de", "Fehler"))
      .toBe("Die Rechnung konnte nicht erstellt werden. Versuchen Sie es erneut.");
  });

  it("preserves unknown errors and provides a fallback", () => {
    expect(invoiceCreationErrorMessage(new Error("Specific error"), "ru", "Ошибка")).toBe("Specific error");
    expect(invoiceCreationErrorMessage(new Error("toString"), "ru", "Ошибка")).toBe("toString");
    expect(invoiceCreationErrorMessage(null, "ru", "Ошибка")).toBe("Ошибка");
  });
});
