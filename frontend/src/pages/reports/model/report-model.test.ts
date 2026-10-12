import { describe, expect, it } from "vitest";

import { getRevenueReportsText } from "@/lib/i18n/catalogs/revenue";

import { formatDays, formatHours, leadCountryLabel } from "./report-model";

describe("top lead countries (QA E3-06)", () => {
  it("names ISO codes in the UI language and translates 'not specified'", () => {
    expect(leadCountryLabel({ country: "DE" }, "ru", "Не указана")).toBe("Германия");
    expect(leadCountryLabel({ country: "DE" }, "de", "Nicht angegeben")).toBe("Deutschland");
    expect(leadCountryLabel({ country: null, label: null }, "ru", "Не указана")).toBe("Не указана");
    expect(leadCountryLabel({ country: null, label: "Atlantis" }, "de", "Nicht angegeben")).toBe("Atlantis");
  });

  it("counts countries with the right word form", () => {
    expect(getRevenueReportsText("ru").sales.leadCountries(1)).toBe("1 страна по лидам");
    expect(getRevenueReportsText("ru").sales.leadCountries(3)).toBe("3 страны по лидам");
    expect(getRevenueReportsText("ru").sales.leadCountries(5)).toBe("5 стран по лидам");
    expect(getRevenueReportsText("de").sales.leadCountries(1)).toBe("1 Lead-Land");
    expect(getRevenueReportsText("de").sales.countryNotSpecified).toBe("Nicht angegeben");
  });
});

describe("report durations (QA E-25)", () => {
  it("uses the UI language unit and a decimal comma", () => {
    expect(formatDays(2.34, "-", "ru")).toBe("2,3 дн.");
    expect(formatDays(2.34, "-", "de")).toBe("2,3 Tage");
    expect(formatHours(3.4, "-", "ru")).toBe("3,4 ч");
    expect(formatHours(3.4, "-", "de")).toBe("3,4 Std.");
  });

  it("keeps the empty label when there is no value", () => {
    expect(formatDays(null, "keine Basis", "de")).toBe("keine Basis");
    expect(formatHours(Number.NaN, "нет", "ru")).toBe("нет");
  });
});
