import { describe, expect, it } from "vitest";

import {
  priceVersionDisplayName,
  serviceBillingUnitBadgeClass,
  serviceBillingUnitLabel,
} from "./order-service-presentation";

describe("priceVersionDisplayName", () => {
  it("drops the automatic name and writes other dates DD.MM.YYYY", () => {
    const price = { valid_from: "2026-04-13", unit_price: "550.00", currency: "EUR" };
    expect(priceVersionDisplayName({ ...price, name: "2026-04-13 · 550.00 EUR" })).toBeNull();
    expect(priceVersionDisplayName({ ...price, name: "2026-04-13 · 550 EUR" })).toBeNull();
    expect(priceVersionDisplayName({ ...price, name: "Tarif ab 2026-04-13" })).toBe("Tarif ab 13.04.2026");
    // Another date or price is a real name: kept, dates rewritten.
    expect(priceVersionDisplayName({ ...price, name: "2026-01-01 · 500.00 EUR" })).toBe("01.01.2026 · 500.00 EUR");
    expect(priceVersionDisplayName({ ...price, name: "  " })).toBeNull();
    expect(priceVersionDisplayName({ ...price, name: null })).toBeNull();
  });
});

const ru = (value: string) => value;
const de = (_ru: string, value: string) => value;

describe("serviceBillingUnitLabel", () => {
  it.each([
    ["item", "шт.", "Stk."],
    ["Items", "шт.", "Stk."],
    ["Stück", "шт.", "Stk."],
    ["ride", "поездка", "Fahrt"],
    ["Fahrt", "поездка", "Fahrt"],
    ["hour", "час", "Stunde"],
    ["Std.", "час", "Stunde"],
    ["day", "день", "Tag"],
    ["unit", "единица", "Einheit"],
    ["appointment", "приём", "Termin"],
    ["package", "пакет", "Paket"],
  ])("localizes the catalog unit %s", (unitLabel, expectedRu, expectedDe) => {
    expect(serviceBillingUnitLabel(unitLabel, ru)).toBe(expectedRu);
    expect(serviceBillingUnitLabel(unitLabel, de)).toBe(expectedDe);
  });

  it("keeps a custom unit as typed and falls back to a unit when empty", () => {
    expect(serviceBillingUnitLabel(" Pauschale ", de)).toBe("Pauschale");
    expect(serviceBillingUnitLabel("", ru)).toBe("единица");
    expect(serviceBillingUnitLabel(null, de)).toBe("Einheit");
  });

  it("styles counted items like units", () => {
    expect(serviceBillingUnitBadgeClass("item")).toBe(serviceBillingUnitBadgeClass("unit"));
    expect(serviceBillingUnitBadgeClass("ride")).toBe(serviceBillingUnitBadgeClass("Pauschale"));
  });
});
