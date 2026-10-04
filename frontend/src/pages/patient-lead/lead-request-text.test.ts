import { describe, expect, it } from "vitest";

import { cabinetLocale, formatFileSize, languageName } from "./lead-request-model";
import { LEAD_CABINET_LANGS, asLeadCabinetLang, leadRequestText } from "./lead-request-text";

describe("lead cabinet languages", () => {
  it("speaks DE, EN, UA and RU", () => {
    expect(LEAD_CABINET_LANGS.map((option) => option.value)).toEqual(["de", "en", "uk", "ru"]);
    expect(leadRequestText("de").title).toBe("Ihre Anfrage");
    expect(leadRequestText("en").title).toBe("Your request");
    expect(leadRequestText("uk").stepDocuments).toBe("Документи");
    expect(leadRequestText("ru").stepDocuments).toBe("Документы");
  });

  it("reads stored and preferred language codes", () => {
    expect(asLeadCabinetLang("uk-UA")).toBe("uk");
    expect(asLeadCabinetLang("UA")).toBe("uk");
    expect(asLeadCabinetLang("EN")).toBe("en");
    expect(asLeadCabinetLang("tr")).toBeNull();
    expect(asLeadCabinetLang(null)).toBeNull();
    // Unknown languages fall back to Russian, like the portal.
    expect(leadRequestText("tr").title).toBe("Ваша заявка");
  });

  it("formats sizes and language names in the cabinet language", () => {
    expect(cabinetLocale("uk")).toBe("uk-UA");
    expect(formatFileSize(1536, "en")).toBe("2 KB");
    expect(languageName("de", "en")).toBe("German");
    expect(languageName("de", "uk")).toBe("Німецька");
  });

  it("has every text in every language", () => {
    const keys = Object.keys(leadRequestText("de")).sort();
    for (const option of LEAD_CABINET_LANGS) {
      expect(Object.keys(leadRequestText(option.value)).sort()).toEqual(keys);
    }
  });
});
