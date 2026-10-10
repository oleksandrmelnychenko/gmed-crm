import { X } from "lucide-react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { COUNTRY_CODES, countryLabel, countrySearchText } from "@/components/ui/country-select";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Normalises citizenships to unique upper-case ISO 3166-1 alpha-2 codes, the
 * form `leads.citizenships` / `patients.citizenships` store (owner decision
 * 2026-10-03: a person may hold several citizenships).
 */
export function normalizeCitizenships(values: readonly string[]): string[] {
  const known = new Set(COUNTRY_CODES);
  const result: string[] = [];
  for (const value of values) {
    const code = value.trim().toUpperCase();
    if (known.has(code) && !result.includes(code)) result.push(code);
  }
  return result;
}

/** Picks several citizenships from the ISO country list; chips remove one. */
export function CitizenshipMultiSelect({
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
  id,
  invalid = false,
  lang: displayLang,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  invalid?: boolean;
  /** Language of the country names; defaults to the UI language. */
  lang?: string;
}) {
  const { t, lang: uiLang } = useLang();
  const lang = displayLang ?? uiLang;
  const selected = normalizeCitizenships(value);
  const options = COUNTRY_CODES.map((code) => ({ value: code, label: `${countryLabel(code, lang)} (${code})` }))
    .sort((left, right) => left.label.localeCompare(right.label, lang));

  const toggle = (code: string) => {
    if (!code) return;
    onChange(
      selected.includes(code)
        ? selected.filter((item) => item !== code)
        : [...selected, code],
    );
  };

  // One field: the chosen countries as chips in a row, then the picker that
  // adds the next one (owner 2026-10-07: chips inline, no greyed-out look).
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-field text-sm transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",
        className,
        "h-auto min-h-9 px-1 py-1",
        invalid && "border-destructive",
        disabled && "opacity-80",
      )}
    >
      {selected.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => toggle(code)}
          disabled={disabled}
          className={cn(
            "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40",
            disabled && "cursor-default hover:border-border hover:bg-card",
          )}
          title={countryLabel(code, lang)}
          aria-label={`${t.common_remove}: ${countryLabel(code, lang)}`}
        >
          <span className="font-mono text-[11px] text-muted-foreground">{code}</span>
          <span className="min-w-0 truncate">{countryLabel(code, lang)}</span>
          {!disabled ? <X className="size-3 shrink-0" /> : null}
        </button>
      ))}
      <NativeComboboxSelect
        id={id}
        value=""
        onChange={(event) => toggle(event.target.value)}
        className="h-7 w-auto min-w-[10rem] flex-1 border-0 bg-transparent px-2 shadow-none hover:bg-transparent focus-visible:ring-0 data-placeholder:text-muted-foreground"
        aria-invalid={invalid || undefined}
        disabled={disabled}
        selectedValues={selected}
        showValueIndicator={false}
        hidePlaceholderOption
        title={selected.map((code) => countryLabel(code, lang)).join(", ") || placeholder}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value} data-search-text={countrySearchText(option.value, option.label)}>
            {option.label}
          </option>
        ))}
      </NativeComboboxSelect>
    </div>
  );
}
