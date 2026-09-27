import { describe, expect, it } from "vitest";

import {
  serviceBillingUnitBadgeClass,
  serviceBillingUnitLabel,
} from "./order-service-presentation";

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
