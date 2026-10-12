import { describe, expect, it } from "vitest";

import { seedTaxProfileNameByText, seedTaxProfileText } from "./tax-profile-labels";

// QA D-12/D-44: the invoice card showed "Standard VAT" / "Termin fee 0% VAT".
describe("seeded tax profile names on the invoice card", () => {
  it("names a seeded profile in the UI language by key or by its stored name", () => {
    expect(seedTaxProfileText("standard_vat", "Standard VAT", "name", "ru")).toBe("Стандартная ставка НДС");
    expect(seedTaxProfileNameByText("Termin fee 0% VAT", "ru")).toBe("Организация лечения, НДС 0 %");
    expect(seedTaxProfileNameByText("Termin fee 0% VAT", "de")).toBe("Behandlungsorganisation, 0 % USt.");
  });

  it("keeps a profile name the agency entered itself", () => {
    expect(seedTaxProfileNameByText("Hotel 7 %", "ru")).toBeNull();
    expect(seedTaxProfileText("standard_vat", "Regelsatz Agentur", "name", "ru")).toBeNull();
  });
});
