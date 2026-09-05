import { describe, expect, it } from "vitest";
import { canGrantInvoiceBillingRelease, hasInvoiceBillingRelease, invoiceCreationErrorMessage } from "./billing-release";
import type { InvoiceBillingRelease } from "./types";

describe("invoice billing release", () => {
  it("requires an explicit release even for a package-covered order", () => {
    for (const status of ["pending", "denied", "granted"] as const) {
      for (const coverage of ["covered", "not_covered", "unknown"]) {
        const release: InvoiceBillingRelease = { billing_release_status: status, billing_release_note: null, package_coverage_status: coverage };
        expect(hasInvoiceBillingRelease(release)).toBe(status === "granted");
      }
    }
    expect(hasInvoiceBillingRelease(null)).toBe(false);
    expect(hasInvoiceBillingRelease(undefined)).toBe(false);
  });

  it("limits the release action to the same roles as the order endpoint", () => {
    for (const role of ["ceo", "billing", "patient_manager", "ceo_assistant", "patient", "doctor", undefined]) {
      expect(canGrantInvoiceBillingRelease(role)).toBe(role === "ceo" || role === "billing");
    }
  });

  it.each([
    "Order requires billing release before invoice creation",
    "Order is package-covered and has no billing release for invoice creation",
  ])("explains the server billing rejection in the selected language: %s", (message) => {
    expect(invoiceCreationErrorMessage(new Error(message), "ru", "Ошибка")).toContain("бухгалтер или директор");
    expect(invoiceCreationErrorMessage(new Error(message), "de", "Fehler")).toContain("Abrechnungsfreigabe");
  });

  it("preserves unknown errors and provides a fallback", () => {
    expect(invoiceCreationErrorMessage(new Error("Specific error"), "ru", "Ошибка")).toBe("Specific error");
    expect(invoiceCreationErrorMessage(null, "ru", "Ошибка")).toBe("Ошибка");
  });
});
