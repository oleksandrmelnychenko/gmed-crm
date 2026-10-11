import { describe, expect, it } from "vitest";

import {
  agencyCatalogItemName,
  agencyServiceLineDisplayDescription,
  agencyServiceLineDisplayName,
  agencyServiceLineName,
  agencyServiceNameLabel,
  agencyServiceStoredName,
  agencyServiceUnitLabel,
  germanDocumentUnitLabel,
} from "./agency-service-labels";
import { t } from "./i18n";

// QA 2026-10-11 C-07/C-09/D-12: raw English/German catalogue names in the RU UI.
describe("catalogue names in the UI language", () => {
  it("localizes a line that still carries a catalogue name, in any language it was stored", () => {
    for (const stored of ["Interpreter support", "Dolmetscherbetreuung", "Услуги переводчика"]) {
      expect(agencyServiceLineName("interpreter_hours", stored, t("ru"))).toBe("Услуги переводчика");
      expect(agencyServiceLineName(undefined, stored, t("de"))).toBe("Dolmetscherbetreuung");
    }
    expect(agencyServiceLineName(undefined, "ORGANISATION DER BEHANDLUNG", t("ru"))).toBe("Организация лечения");
  });

  it("keeps a line text staff typed themselves", () => {
    expect(agencyServiceLineName("interpreter_hours", "Zusatzbegleitung 1 Stunde", t("ru"))).toBe(
      "Zusatzbegleitung 1 Stunde",
    );
  });

  it("prefers the Russian name the agency entered for its own catalogue items", () => {
    const service = {
      service_key: "herz_check",
      service_name: "Herz-Check-up",
      description: "Untersuchung beim Kardiologen.",
      name_ru: "Кардио-чекап",
      description_ru: "Обследование у кардиолога.",
    };
    expect(agencyCatalogItemName(service, t("ru"), "ru")).toBe("Кардио-чекап");
    expect(agencyCatalogItemName(service, t("de"), "de")).toBe("Herz-Check-up");
    expect(agencyServiceLineDisplayName("Herz-Check-up", service, t("ru"), "ru")).toBe("Кардио-чекап");
    expect(agencyServiceLineDisplayName("Herz-Check-up (2 Ärzte)", service, t("ru"), "ru")).toBe(
      "Herz-Check-up (2 Ärzte)",
    );
    expect(
      agencyServiceLineDisplayDescription(
        "Untersuchung beim Kardiologen.",
        "Untersuchung beim Kardiologen.",
        service,
        t("ru"),
        "ru",
      ),
    ).toBe("Обследование у кардиолога.");
    expect(
      agencyServiceLineDisplayDescription(
        "Medical interpretation billed per hour.",
        "Medical interpretation billed per hour.",
        { service_key: "interpreter_hours" },
        t("ru"),
        "ru",
      ),
    ).toBe("Медицинский перевод с почасовой оплатой.");
  });

  it("prints German units on documents", () => {
    expect(germanDocumentUnitLabel("item")).toBe("Stück");
    expect(germanDocumentUnitLabel("hour")).toBe("Std.");
    expect(germanDocumentUnitLabel("поездка")).toBe("Fahrt");
    expect(germanDocumentUnitLabel("Pauschale")).toBe("Pauschale");
    expect(germanDocumentUnitLabel(undefined)).toBe("");
  });
});

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
