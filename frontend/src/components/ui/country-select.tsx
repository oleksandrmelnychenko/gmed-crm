import { useMemo } from "react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";

/**
 * Comprehensive ISO 3166-1 alpha-2 country codes (uppercase). Labels are
 * resolved at render time via `Intl.DisplayNames`, so this list only carries
 * the codes — the localized names follow the active UI language.
 */
export const COUNTRY_CODES: readonly string[] = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR",
  "AS", "AT", "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE",
  "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ",
  "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD",
  "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR",
  "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM",
  "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI",
  "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF",
  "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS",
  "GT", "GU", "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU",
  "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN",
  "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK",
  "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME",
  "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ",
  "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA",
  "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU",
  "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM",
  "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS",
  "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI",
  "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV",
  "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK",
  "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA",
  "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI",
  "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW",
];

const COUNTRY_CODE_SET = new Set(COUNTRY_CODES);
let countryCodeByLocalizedName: Map<string, string> | null = null;

function countryNameKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function countryCodeFromStoredValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  const upper = trimmed.toUpperCase();
  if (COUNTRY_CODE_SET.has(upper)) return upper;

  if (!countryCodeByLocalizedName) {
    countryCodeByLocalizedName = new Map<string, string>();
    for (const locale of ["de", "en", "ru"]) {
      try {
        const display = new Intl.DisplayNames([locale], { type: "region" });
        for (const code of COUNTRY_CODES) {
          const label = display.of(code);
          if (label) countryCodeByLocalizedName.set(countryNameKey(label), code);
        }
      } catch {
        // Keep unknown stored values as-is when localized region names are unavailable.
      }
    }
  }

  return countryCodeByLocalizedName.get(countryNameKey(trimmed)) ?? trimmed;
}

export function countryNameForGermanDocument(value: string | null | undefined) {
  const normalized = countryCodeFromStoredValue(value);
  if (!normalized) return "";

  const code = normalized.toUpperCase();
  return COUNTRY_CODE_SET.has(code) ? countryLabel(code, "de") : normalized;
}

/** Localized human-readable country name for an ISO alpha-2 code. */
export function countryLabel(code: string | null | undefined, lang: string): string {
  if (!code) {
    return "";
  }
  const upper = code.toUpperCase();
  try {
    const display = new Intl.DisplayNames([lang === "de" ? "de" : "ru"], { type: "region" });
    return display.of(upper) ?? upper;
  } catch {
    return upper;
  }
}

export function CountrySelect({
  value,
  onChange,
  lang,
  className,
  "aria-label": ariaLabel,
  includeEmpty = true,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
  lang: string;
  className?: string;
  "aria-label"?: string;
  includeEmpty?: boolean;
}) {
  const selectedValue = countryCodeFromStoredValue(value);
  const options = useMemo(() => {
    const collator = new Intl.Collator(lang === "de" ? "de" : "ru");
    const knownOptions = COUNTRY_CODES.map((code) => ({ code, label: countryLabel(code, lang) })).sort(
      (a, b) => collator.compare(a.label, b.label),
    );
    const currentValue = selectedValue.trim();
    if (currentValue && !COUNTRY_CODE_SET.has(currentValue.toUpperCase())) {
      return [{ code: currentValue, label: currentValue }, ...knownOptions];
    }
    return knownOptions;
  }, [lang, selectedValue]);

  return (
    <NativeComboboxSelect
      value={selectedValue}
      aria-label={ariaLabel}
      className={className}
      onChange={(event) => onChange(event.target.value || null)}
    >
      {includeEmpty ? <option value="">—</option> : null}
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.label}
        </option>
      ))}
    </NativeComboboxSelect>
  );
}
