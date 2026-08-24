import {
  countryCodeFromStoredValue,
  countryNameForDisplay,
} from "@/components/ui/country-select";

const LEGACY_NATIONALITY_COUNTRY_CODES: Record<string, string> = {
  american: "US",
  austrian: "AT",
  brazilian: "BR",
  british: "GB",
  chinese: "CN",
  czech: "CZ",
  danish: "DK",
  egyptian: "EG",
  emirati: "AE",
  german: "DE",
  ghanaian: "GH",
  greek: "GR",
  latvian: "LV",
  nigerian: "NG",
  pakistani: "PK",
  polish: "PL",
  russian: "RU",
  saudi: "SA",
  swiss: "CH",
  turkish: "TR",
  ukrainian: "UA",
};

/**
 * Converts legacy demonyms to the ISO country code now used for citizenship.
 * Existing country names and ISO codes are handled by the shared country parser.
 */
export function nationalityCountryCode(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  return (
    LEGACY_NATIONALITY_COUNTRY_CODES[trimmed.toLocaleLowerCase()] ??
    countryCodeFromStoredValue(trimmed)
  );
}

export function nationalityNameForDisplay(
  value: string | null | undefined,
  lang: string,
) {
  return countryNameForDisplay(nationalityCountryCode(value), lang);
}
