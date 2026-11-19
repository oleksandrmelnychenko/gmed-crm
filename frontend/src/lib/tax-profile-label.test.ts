import { describe, expect, it } from "vitest";

import { taxProfileLabel } from "./tax-profile-label";

describe("taxProfileLabel", () => {
  it("names the system profiles in the UI language", () => {
    expect(taxProfileLabel({ profile_key: "standard_vat", name: "Standard VAT" }, "ru")).toBe("Стандартная ставка 19 %");
    expect(taxProfileLabel({ profile_key: "termin_fee_0", name: "Termin fee 0% VAT" }, "de")).toBe(
      "Organisation der Behandlung 0 % (§ 4 Nr. 14 UStG)",
    );
    expect(taxProfileLabel({ profile_key: "pass_through_0", name: "Durchlaufender Posten 0 %" }, "ru")).toBe(
      "Транзитные расходы 0 %",
    );
    expect(taxProfileLabel({ profile_key: "vat_exempt_0", name: "VAT exempt 0%" }, "ru")).toBe("Без НДС (освобождено) 0 %");
  });

  it("keeps the stored name of a profile staff created", () => {
    expect(taxProfileLabel({ profile_key: "reduced_7", name: "Ermäßigt 7 %" }, "ru")).toBe("Ermäßigt 7 %");
    expect(taxProfileLabel({ name: "Custom" }, "de")).toBe("Custom");
  });
});
