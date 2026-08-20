import { describe, expect, it } from "vitest";

import {
  blankLeistungForm,
  externalInvoiceStatusTransitions,
  formatOptionalCurrency,
} from "./order-model";

describe("externalInvoiceStatusTransitions", () => {
  it("keeps incoming invoices on the explicit approval path", () => {
    expect(externalInvoiceStatusTransitions("expected")).toEqual([
      "received",
      "cancelled",
    ]);
    expect(externalInvoiceStatusTransitions("received")).toEqual([
      "approved",
      "cancelled",
    ]);
    expect(externalInvoiceStatusTransitions("approved")).toEqual([
      "paid",
      "cancelled",
    ]);
  });

  it("treats paid and cancelled invoices as terminal", () => {
    expect(externalInvoiceStatusTransitions("paid")).toEqual([]);
    expect(externalInvoiceStatusTransitions("cancelled")).toEqual([]);
  });
});

describe("formatOptionalCurrency", () => {
  it("does not render unavailable financial values as zero", () => {
    expect(formatOptionalCurrency(null, "EUR", "de-DE", "Nicht berechenbar"))
      .toBe("Nicht berechenbar");
    expect(formatOptionalCurrency("12.50", "EUR")).toContain("12,50");
  });
});

describe("blankLeistungForm", () => {
  it("starts as a manual service until a catalog item is selected", () => {
    expect(blankLeistungForm()).toMatchObject({
      agencyServiceId: "",
      description: "",
      quantity: "1",
      unitPrice: "",
      vatRate: "19",
    });
  });
});
