import { describe, expect, it } from "vitest";

import {
  leistungUnitPriceProblem,
  leistungVatRateProblem,
  localizeLeistungServerError,
} from "./leistung-form-errors";

describe("add service: each refusal names its own rule (QA 2026-11-10, D-08)", () => {
  it("a negative price is not «must be a number»", () => {
    expect(leistungUnitPriceProblem("-50", "ru")).toBe("Цена за единицу не может быть отрицательной.");
    expect(leistungUnitPriceProblem("-50,00", "de")).toBe("Der Einzelpreis darf nicht negativ sein.");
  });

  it("three decimals are named as such", () => {
    expect(leistungUnitPriceProblem("10,005", "ru")).toContain("двумя знаками после запятой");
    expect(leistungUnitPriceProblem("10,0051", "de")).toContain("zwei Nachkommastellen");
    // "10.005" is ten thousand and five in the German spelling.
    expect(leistungUnitPriceProblem("10.005", "de")).toBeNull();
  });

  it("text and an empty field keep their own messages", () => {
    expect(leistungUnitPriceProblem("abc", "ru")).toBe("Цена за единицу должна быть числом.");
    expect(leistungUnitPriceProblem("  ", "ru")).toBe("Укажите цену за единицу.");
  });

  it("accepts amounts as staff type them", () => {
    for (const price of ["0", "95", "333,33", "1.250,00", "99999999,99"]) {
      expect(leistungUnitPriceProblem(price, "ru"), price).toBeNull();
    }
  });

  it("a VAT rate outside 0–100 names the range", () => {
    expect(leistungVatRateProblem("-5", "ru")).toBe("Ставка НДС должна быть от 0 до 100 %.");
    expect(leistungVatRateProblem("150", "de")).toBe("Der USt.-Satz muss zwischen 0 und 100 % liegen.");
    expect(leistungVatRateProblem("x", "ru")).toBe("Ставка НДС должна быть числом.");
    expect(leistungVatRateProblem("19", "ru")).toBeNull();
    expect(leistungVatRateProblem("7,5", "ru")).toBeNull();
    expect(leistungVatRateProblem("0", "de")).toBeNull();
  });
});

describe("add service: server messages in the UI language (QA 2026-11-10, D-07)", () => {
  it("translates the known refusals", () => {
    expect(localizeLeistungServerError("Service VAT rate must be between 0 and 100", "ru")).toBe(
      "Ставка НДС должна быть от 0 до 100 %.",
    );
    expect(
      localizeLeistungServerError("Service quantity or price is outside the supported amount range", "ru"),
    ).toContain("слишком велики");
    expect(
      localizeLeistungServerError("Service quantity or price is outside the supported amount range", "de"),
    ).toContain("zu groß");
    expect(localizeLeistungServerError("Service unit price cannot be negative.", "de")).toBe(
      "Der Einzelpreis darf nicht negativ sein.",
    );
  });

  it("shows an unknown message as sent", () => {
    expect(localizeLeistungServerError("Order is closed", "ru")).toBe("Order is closed");
  });
});
