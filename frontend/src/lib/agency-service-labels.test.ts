import { describe, expect, it } from "vitest";

import {
  agencyServiceNameLabel,
  agencyServiceStoredName,
  agencyServiceUnitLabel,
} from "./agency-service-labels";
import { t } from "./i18n";

describe("agencyServiceStoredName", () => {
  it("stores the catalog name whatever the UI language", () => {
    const ru = agencyServiceStoredName("treatment_organization", "Organisation der Behandlung", t("ru"));
    const de = agencyServiceStoredName("treatment_organization", "Organisation der Behandlung", t("de"));
    expect(ru).toBe("Organisation der Behandlung");
    expect(de).toBe("Organisation der Behandlung");
    // The display label is still localized.
    expect(agencyServiceNameLabel("treatment_organization", "Organisation der Behandlung", t("ru"))).not.toBe(ru);
  });

  it("falls back to the localized label when the catalog has no name", () => {
    expect(agencyServiceStoredName("treatment_organization", "  ", t("de"))).toBe(
      agencyServiceNameLabel("treatment_organization", null, t("de")),
    );
  });
});

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
