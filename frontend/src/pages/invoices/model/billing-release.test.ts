import { describe, expect, it } from "vitest";
import { invoiceCreationErrorMessage } from "./billing-release";

describe("invoice creation errors", () => {
  it("explains server rejections in the selected language", () => {
    const message = "Cannot invoice a rejected or expired quote";
    expect(invoiceCreationErrorMessage(new Error(message), "ru", "Ошибка")).toContain("отклонённому");
    expect(invoiceCreationErrorMessage(new Error(message), "de", "Fehler")).toContain("abgelehntes");
  });

  it("preserves unknown errors and provides a fallback", () => {
    expect(invoiceCreationErrorMessage(new Error("Specific error"), "ru", "Ошибка")).toBe("Specific error");
    expect(invoiceCreationErrorMessage(null, "ru", "Ошибка")).toBe("Ошибка");
  });
});
