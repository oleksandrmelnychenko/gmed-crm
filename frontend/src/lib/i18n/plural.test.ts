import { describe, expect, it } from "vitest";

import { formatPluralCount, t } from "@/lib/i18n";

const ruPatients = {
  one: t("ru").patients_list_count_one,
  few: t("ru").patients_list_count_few,
  many: t("ru").patients_list_count_many,
};
const dePatients = {
  one: t("de").patients_list_count_one,
  few: t("de").patients_list_count_few,
  many: t("de").patients_list_count_many,
};

describe("formatPluralCount", () => {
  it("uses the Russian one / few / many forms", () => {
    expect(formatPluralCount("ru", 1, ruPatients)).toBe("1 пациент");
    expect(formatPluralCount("ru", 3, ruPatients)).toBe("3 пациента");
    expect(formatPluralCount("ru", 5, ruPatients)).toBe("5 пациентов");
    expect(formatPluralCount("ru", 11, ruPatients)).toBe("11 пациентов");
    expect(formatPluralCount("ru", 21, ruPatients)).toBe("21 пациент");
    expect(formatPluralCount("ru", 0, ruPatients)).toBe("0 пациентов");
  });

  it("uses the German singular only for one", () => {
    expect(formatPluralCount("de", 1, dePatients)).toBe("1 Patient");
    expect(formatPluralCount("de", 2, dePatients)).toBe("2 Patienten");
    expect(formatPluralCount("de", 0, dePatients)).toBe("0 Patienten");
  });

  it("can show the count differently while the number picks the form", () => {
    expect(formatPluralCount("ru", 40, ruPatients, { count: "12 / 40" })).toBe("12 / 40 пациентов");
  });

  it("says that one required document is missing in German", () => {
    const de = t("de");
    const forms = {
      one: de.portal_dashboard_missing_required_document_one,
      few: de.portal_dashboard_missing_required_document_many,
      many: de.portal_dashboard_missing_required_document_many,
    };
    expect(formatPluralCount("de", 1, forms)).toBe("Es fehlt noch 1 Pflichtdokument.");
    expect(formatPluralCount("de", 2, forms)).toBe("Es fehlen noch 2 Pflichtdokumente.");
  });
});
