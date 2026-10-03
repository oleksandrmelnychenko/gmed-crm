import { X } from "lucide-react";

import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { COUNTRY_CODES, countryLabel } from "@/components/ui/country-select";
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
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  invalid?: boolean;
}) {
  const { t, lang } = useLang();
  const selected = normalizeCitizenships(value);
  const options = COUNTRY_CODES.map((code) => ({ value: code, label: `${countryLabel(code, lang)} (${code})` }))
    .sort((left, right) => left.label.localeCompare(right.label, lang));
  const triggerLabel =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? countryLabel(selected[0], lang)
        : `${placeholder}: ${selected.length}`;

  const toggle = (code: string) => {
    if (!code) return;
    onChange(
      selected.includes(code)
        ? selected.filter((item) => item !== code)
        : [...selected, code],
    );
  };

  return (
    <div className="space-y-2">
      <NativeComboboxSelect
        id={id}
        value=""
        onChange={(event) => toggle(event.target.value)}
        className={cn(className, invalid && "border-destructive")}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        selectedValues={selected}
        showValueIndicator={false}
        hidePlaceholderOption
        title={selected.map((code) => countryLabel(code, lang)).join(", ") || placeholder}
      >
        <option value="">{triggerLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeComboboxSelect>
      {selected.length > 0 ? (
        <div className="flex min-h-8 flex-wrap gap-1.5 rounded-lg border border-border/70 bg-muted/20 p-1.5">
          {selected.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => toggle(code)}
              disabled={disabled}
              className={cn(
                "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[12px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40",
                disabled && "cursor-default opacity-80 hover:border-border hover:bg-card",
              )}
              title={countryLabel(code, lang)}
              aria-label={`${t.common_remove}: ${countryLabel(code, lang)}`}
            >
              <span className="font-mono text-[11px] text-muted-foreground">{code}</span>
              <span className="min-w-0 truncate">{countryLabel(code, lang)}</span>
              {!disabled ? <X className="size-3 shrink-0" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
