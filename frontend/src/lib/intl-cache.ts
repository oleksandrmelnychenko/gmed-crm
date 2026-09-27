import { appDateTimeFormat } from "@/lib/app-time-zone";

/**
 * Module-level caches for Intl formatters. Constructing Intl objects allocates
 * dozens of objects per locale lookup; table cells and list rows call these
 * formatters hundreds of times per render, so instances are reused.
 */

const numberFormatters = new Map<string, Intl.NumberFormat>();

export function cachedNumberFormat(
  locale: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatters.set(key, formatter);
  }
  return formatter;
}

/**
 * Renders in the app time zone (Europe/Berlin) unless the options name an
 * explicit `timeZone`; see `@/lib/app-time-zone`.
 */
export function cachedDateTimeFormat(
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return appDateTimeFormat(locale, options);
}

const regionDisplayNames = new Map<string, Intl.DisplayNames | null>();

/** Returns null when localized region names are unavailable in this runtime. */
export function cachedRegionDisplayNames(locale: string): Intl.DisplayNames | null {
  if (!regionDisplayNames.has(locale)) {
    try {
      regionDisplayNames.set(locale, new Intl.DisplayNames([locale], { type: "region" }));
    } catch {
      regionDisplayNames.set(locale, null);
    }
  }
  return regionDisplayNames.get(locale) ?? null;
}

const languageDisplayNames = new Map<string, Intl.DisplayNames | null>();

/** Returns null when localized language names are unavailable in this runtime. */
export function cachedLanguageDisplayNames(locale: string): Intl.DisplayNames | null {
  if (!languageDisplayNames.has(locale)) {
    try {
      languageDisplayNames.set(locale, new Intl.DisplayNames([locale], { type: "language" }));
    } catch {
      languageDisplayNames.set(locale, null);
    }
  }
  return languageDisplayNames.get(locale) ?? null;
}
