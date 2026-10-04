import { describe, expect, it } from "vitest";

import { cabinetLocale, formatFileSize, languageName } from "./lead-request-model";
import { LEAD_CABINET_LANGS, asLeadCabinetLang, leadRequestText, resolveLeadCabinetLang } from "./lead-request-text";

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

  it("keeps a UA or EN choice and lets a DE/RU cabinet follow the portal language", () => {
    // UA and EN exist only in the cabinet: the portal toggle does not undo them.
    expect(resolveLeadCabinetLang("uk", "de", "ru")).toBe("uk");
    expect(resolveLeadCabinetLang("en", null, "de")).toBe("en");
    // A DE/RU choice is the portal language: the top bar toggle switches the cabinet too.
    expect(resolveLeadCabinetLang("de", "de", "ru")).toBe("ru");
    expect(resolveLeadCabinetLang("ru", "uk", "de")).toBe("de");
    // No choice yet: a UA/EN request language applies, otherwise the portal language.
    expect(resolveLeadCabinetLang(null, "uk", "de")).toBe("uk");
    expect(resolveLeadCabinetLang(null, "de", "ru")).toBe("ru");
    expect(resolveLeadCabinetLang(null, null, "de")).toBe("de");
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
