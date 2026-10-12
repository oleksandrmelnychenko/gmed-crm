import { describe, expect, it } from "vitest";

import { formatUiText, t } from "./index";

function plural(lang: "de" | "ru", count: number) {
  const category = new Intl.PluralRules(lang).select(count);
  return formatUiText(t(lang).uiText[`appointments_package_items_count_${category}`], { count });
}

describe("QA round-3 texts of group C", () => {
  it("counts package items in the right Russian form (C3-08)", () => {
    expect(plural("ru", 0)).toBe("0 пунктов пакета");
    expect(plural("ru", 1)).toBe("1 пункт пакета");
    expect(plural("ru", 2)).toBe("2 пункта пакета");
    expect(plural("ru", 5)).toBe("5 пунктов пакета");
    expect(plural("de", 1)).toBe("1 Paketelement");
    expect(plural("de", 3)).toBe("3 Paketelemente");
  });

  it("labels the chauffeur service kind the same on every screen (C3-06)", () => {
    for (const lang of ["ru", "de"] as const) {
      const labels = t(lang) as unknown as Record<string, string>;
      const names = new Set([
        labels.staff_services_kind_chauffeur,
        labels.appointment_concierge_service_kind_chauffeur,
        labels.services_type_chauffeur,
        labels.portal_concierge_kind_chauffeur,
      ]);
      expect([...names], lang).toEqual([lang === "ru" ? "Водитель" : "Chauffeur"]);
    }
  });
});
