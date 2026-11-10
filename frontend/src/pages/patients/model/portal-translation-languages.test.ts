import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import {
  PORTAL_TRANSLATION_LANGUAGE_KEYS,
  PORTAL_TRANSLATION_LANGUAGES,
  portalTranslationDefaultLanguage,
} from "./portal-translation-languages";

describe("translation target languages of the portal (owner decision 2026-11-10)", () => {
  it("offers the patient's languages and German, not German alone", () => {
    expect([...PORTAL_TRANSLATION_LANGUAGES].sort()).toEqual(["de", "en", "es", "ru", "uk"]);
  });

  it("starts with the patient's own language", () => {
    expect(portalTranslationDefaultLanguage("uk", "ru")).toBe("uk");
    expect(portalTranslationDefaultLanguage("ua", "de")).toBe("uk");
    expect(portalTranslationDefaultLanguage("en-GB", "de")).toBe("en");
    // No language on the account: the language the portal is shown in.
    expect(portalTranslationDefaultLanguage(null, "ru")).toBe("ru");
    expect(portalTranslationDefaultLanguage("", "de")).toBe("de");
    expect(portalTranslationDefaultLanguage("fr", "xx")).toBe("ru");
  });

  it("names every language in Russian and German", () => {
    for (const language of PORTAL_TRANSLATION_LANGUAGES) {
      const key = PORTAL_TRANSLATION_LANGUAGE_KEYS[language];
      expect(t("ru").uiText[key], key).toBeTruthy();
      expect(t("de").uiText[key], key).toBeTruthy();
    }
  });
});
