import { describe, expect, it } from "vitest";

import { agencyServiceUnitLabel } from "./agency-service-labels";
import { t } from "./i18n";

describe("agencyServiceUnitLabel", () => {
  it.each([
    ["item", "шт.", "Stk."],
    ["ride", "поездка", "Fahrt"],
    ["hour", "час", "Stunde"],
    ["appointment", "приём", "Termin"],
    ["unit", "ед.", "Einheit"],
  ])("localizes the catalog unit %s", (unitLabel, expectedRu, expectedDe) => {
    expect(agencyServiceUnitLabel(unitLabel, t("ru"))).toBe(expectedRu);
    expect(agencyServiceUnitLabel(unitLabel, t("de"))).toBe(expectedDe);
  });

  it("keeps a custom unit as typed", () => {
    expect(agencyServiceUnitLabel("Pauschale", t("de"))).toBe("Pauschale");
  });
});
