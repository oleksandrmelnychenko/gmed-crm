import { describe, expect, it } from "vitest";

import {
  blankLeistungForm,
  externalInvoiceStatusTransitions,
  formatDate,
  formatDateOnly,
  formatDateTime,
  formatOptionalCurrency,
  leistungLineAmounts,
  sumLeistungGross,
  summarizeLeistungMetrics,
  sumLeistungTotals,
} from "./order-model";
import type { Leistung } from "./types";

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

describe("order workspace dates", () => {
  it("shows every date as DD.MM.YYYY, whatever the staff language", () => {
    expect(formatDate("2026-09-27", "ru-RU")).toBe("27.09.2026");
    expect(formatDateOnly("2026-09-27", "ru-RU")).toBe("27.09.2026");
    const timestamp = new Date(2026, 8, 27, 14, 5);
    expect(formatDateTime(timestamp.toISOString(), "ru-RU")).toBe("27.09.2026, 14:05");
    expect(formatDateOnly(timestamp.toISOString(), "de-DE")).toBe("27.09.2026");
  });

  it("does not show a time for date-only values", () => {
    expect(formatDateTime("2026-09-27", "ru-RU")).toBe("27.09.2026");
    // A date stored as a UTC-midnight timestamp is not "27.09.2026, 03:00".
    expect(formatDateTime("2026-09-27T00:00:00+00:00", "ru-RU")).toBe("27.09.2026");
    expect(formatDateTime("2026-09-27T00:00:00Z", "de-DE")).toBe("27.09.2026");
    expect(formatDate("2026-09-27T00:00:00.000Z")).toBe("27.09.2026");
  });

  it("keeps empty and unparseable values readable", () => {
    expect(formatDate(null, "de-DE", "—")).toBe("—");
    expect(formatDateTime("not a date", "de-DE", "—")).toBe("not a date");
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
      agencyServicePriceVersionId: "",
      description: "",
      quantity: "1",
      unitPrice: "",
      currency: "EUR",
      vatRate: "19",
    });
  });
});

describe("sumLeistungTotals", () => {
  const line = (status: Leistung["status"], quantity: string, unitPrice: string) =>
    ({ status, quantity, unit_price: unitPrice }) as Leistung;

  it("leaves cancelled service lines out of the net total", () => {
    expect(sumLeistungTotals([
      line("planned", "2", "100"),
      line("approved", "1", "50.5"),
      line("cancelled", "3", "80"),
    ])).toBeCloseTo(250.5);
  });
});

describe("summarizeLeistungMetrics", () => {
  const line = (status: Leistung["status"]) =>
    ({ status, quantity: "1", unit_price: "100", vat_rate: "19", is_cost_passthrough: false }) as Leistung;

  it("counts approved and invoiced services as delivered and leaves cancelled lines out", () => {
    expect(
      summarizeLeistungMetrics([
        line("planned"),
        line("delivered"),
        line("approved"),
        line("invoiced"),
        line("cancelled"),
      ]),
    ).toEqual({
      total: 4,
      cancelled: 1,
      delivered: 3,
      awaitingApproval: 1,
      approved: 2,
      net: 400,
      gross: 476,
    });
  });
});

describe("leistungLineAmounts / sumLeistungGross", () => {
  const line = (
    status: Leistung["status"],
    quantity: string,
    unitPrice: string,
    vatRate: string,
    isCostPassthrough = false,
  ) =>
    ({
      status,
      quantity,
      unit_price: unitPrice,
      unit_price_snapshot: unitPrice,
      vat_rate: vatRate,
      vat_rate_snapshot: vatRate,
      is_cost_passthrough: isCostPassthrough,
    }) as Leistung;

  it("rounds each line like quotes and invoices", () => {
    expect(leistungLineAmounts(line("planned", "2.5", "95", "19"))).toEqual({
      net: 237.5,
      vat: 45.13,
      gross: 282.63,
    });
    // Pass-through costs carry no VAT even with a rate on the line.
    expect(leistungLineAmounts(line("planned", "1", "100", "19", true)).gross).toBe(100);
  });

  it("is the gross order total: amendment line included, cancelled lines left out", () => {
    expect(
      sumLeistungGross([
        line("planned", "1", "550", "0"),
        // An approved amendment of +150 EUR gross at 19 %.
        line("approved", "1", "126.05", "19"),
        line("cancelled", "3", "80", "19"),
      ]),
    ).toBe(700);
  });
});
