/**
 * Target languages of a translation the patient asks for in the portal
 * (owner decision 2026-11-10): German is the base language of the documents,
 * so the patient usually needs a translation into their own language —
 * Russian, Ukrainian, English or Spanish — and German for a document that
 * came in another language. The server accepts the same five
 * (`patient_document_requests.rs`, `normalize_language`); the staff workspace
 * knows them all. Machine translation covers DE, EN, RU and UK; a Spanish
 * request is translated by hand.
 */
export const PORTAL_TRANSLATION_LANGUAGES = ["ru", "uk", "en", "es", "de"] as const;

export type PortalTranslationLanguage = (typeof PORTAL_TRANSLATION_LANGUAGES)[number];

function asTranslationLanguage(value: string | null | undefined): PortalTranslationLanguage | null {
  const code = (value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  const normalized = code === "ua" ? "uk" : code;
  return (PORTAL_TRANSLATION_LANGUAGES as readonly string[]).includes(normalized)
    ? (normalized as PortalTranslationLanguage)
    : null;
}

/**
 * The language the dialog starts with: the patient's own (the language saved
 * on the account, else the language the portal is shown in).
 */
export function portalTranslationDefaultLanguage(
  accountLanguage: string | null | undefined,
  portalLanguage: string,
): PortalTranslationLanguage {
  return asTranslationLanguage(accountLanguage) ?? asTranslationLanguage(portalLanguage) ?? "ru";
}

/** The `uiText` key of a language's name. */
export const PORTAL_TRANSLATION_LANGUAGE_KEYS: Record<PortalTranslationLanguage, string> = {
  ru: "portal_translation_language_ru",
  uk: "portal_translation_language_uk",
  en: "portal_translation_language_en",
  es: "portal_translation_language_es",
  de: "portal_translation_language_de",
};
