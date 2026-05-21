import {
  formatUnknownValue,
  getLang,
  t as translateCatalog,
  uiText,
  useLang,
} from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  Field,
  Section as FormSection,
  inputClass,
  textareaClass,
} from "@/components/ui-shell";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { LanguageMultiSelect } from "@/components/ui/language-multi-select";

// Re-export shell primitives so existing screens keep working.
// New code should import from "@/components/ui-shell" directly.
export { Field, FormSection };

export const formInputClassName = inputClass;
export const textareaClassName = textareaClass;

type PatientSelectOption = {
  value: string;
  fallbackLabel: string;
  countryCode?: string;
  labelKey?: string;
};

const COUNTRY_OPTIONS: PatientSelectOption[] = [
  { value: "Germany", fallbackLabel: "Germany", countryCode: "DE" },
  { value: "Ukraine", fallbackLabel: "Ukraine", countryCode: "UA" },
  { value: "Austria", fallbackLabel: "Austria", countryCode: "AT" },
  { value: "Switzerland", fallbackLabel: "Switzerland", countryCode: "CH" },
  { value: "Poland", fallbackLabel: "Poland", countryCode: "PL" },
  { value: "Czech Republic", fallbackLabel: "Czech Republic", countryCode: "CZ" },
  { value: "Denmark", fallbackLabel: "Denmark", countryCode: "DK" },
  { value: "Latvia", fallbackLabel: "Latvia", countryCode: "LV" },
  { value: "Greece", fallbackLabel: "Greece", countryCode: "GR" },
  { value: "Turkey", fallbackLabel: "Turkey", countryCode: "TR" },
  { value: "United Arab Emirates", fallbackLabel: "United Arab Emirates", countryCode: "AE" },
  { value: "Saudi Arabia", fallbackLabel: "Saudi Arabia", countryCode: "SA" },
  { value: "Egypt", fallbackLabel: "Egypt", countryCode: "EG" },
  { value: "Nigeria", fallbackLabel: "Nigeria", countryCode: "NG" },
  { value: "Ghana", fallbackLabel: "Ghana", countryCode: "GH" },
  { value: "Brazil", fallbackLabel: "Brazil", countryCode: "BR" },
  { value: "China", fallbackLabel: "China", countryCode: "CN" },
  { value: "Russia", fallbackLabel: "Russia", countryCode: "RU" },
  { value: "Pakistan", fallbackLabel: "Pakistan", countryCode: "PK" },
  { value: "United Kingdom", fallbackLabel: "United Kingdom", countryCode: "GB" },
  { value: "United States", fallbackLabel: "United States", countryCode: "US" },
];

const NATIONALITY_OPTIONS: PatientSelectOption[] = [
  { value: "German", fallbackLabel: "German", labelKey: "patients_nationality_german" },
  { value: "Ukrainian", fallbackLabel: "Ukrainian", labelKey: "patients_nationality_ukrainian" },
  { value: "Austrian", fallbackLabel: "Austrian", labelKey: "patients_nationality_austrian" },
  { value: "Swiss", fallbackLabel: "Swiss", labelKey: "patients_nationality_swiss" },
  { value: "Polish", fallbackLabel: "Polish", labelKey: "patients_nationality_polish" },
  { value: "Czech", fallbackLabel: "Czech", labelKey: "patients_nationality_czech" },
  { value: "Danish", fallbackLabel: "Danish", labelKey: "patients_nationality_danish" },
  { value: "Latvian", fallbackLabel: "Latvian", labelKey: "patients_nationality_latvian" },
  { value: "Greek", fallbackLabel: "Greek", labelKey: "patients_nationality_greek" },
  { value: "Turkish", fallbackLabel: "Turkish", labelKey: "patients_nationality_turkish" },
  { value: "Emirati", fallbackLabel: "Emirati", labelKey: "patients_nationality_emirati" },
  { value: "Saudi", fallbackLabel: "Saudi", labelKey: "patients_nationality_saudi" },
  { value: "Egyptian", fallbackLabel: "Egyptian", labelKey: "patients_nationality_egyptian" },
  { value: "Nigerian", fallbackLabel: "Nigerian", labelKey: "patients_nationality_nigerian" },
  { value: "Ghanaian", fallbackLabel: "Ghanaian", labelKey: "patients_nationality_ghanaian" },
  { value: "Brazilian", fallbackLabel: "Brazilian", labelKey: "patients_nationality_brazilian" },
  { value: "Chinese", fallbackLabel: "Chinese", labelKey: "patients_nationality_chinese" },
  { value: "Russian", fallbackLabel: "Russian", labelKey: "patients_nationality_russian" },
  { value: "Pakistani", fallbackLabel: "Pakistani", labelKey: "patients_nationality_pakistani" },
  { value: "British", fallbackLabel: "British", labelKey: "patients_nationality_british" },
  { value: "American", fallbackLabel: "American", labelKey: "patients_nationality_american" },
];

function normalizeSelectKey(value: string) {
  return value.trim().toLowerCase();
}

function optionExists(options: PatientSelectOption[], value: string) {
  const key = normalizeSelectKey(value);
  return options.some((option) => normalizeSelectKey(option.value) === key);
}

function optionsWithCurrent(options: PatientSelectOption[], value: string) {
  const trimmed = value.trim();
  if (!trimmed || optionExists(options, trimmed)) return options;
  return [{ value: trimmed, fallbackLabel: trimmed }, ...options];
}

function countryOptionLabel(option: PatientSelectOption, lang: "de" | "ru") {
  if (!option.countryCode) return option.fallbackLabel;
  try {
    return (
      new Intl.DisplayNames([lang], { type: "region" }).of(option.countryCode) ??
      option.fallbackLabel
    );
  } catch {
    return option.fallbackLabel;
  }
}

function nationalityOptionLabel(option: PatientSelectOption, lang: "de" | "ru") {
  return option.labelKey ? uiText(option.labelKey, lang) : option.fallbackLabel;
}

export function CountrySelect({
  value,
  onChange,
  placeholder,
  required,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const { lang } = useLang();
  return (
    <NativeComboboxSelect
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn("w-full", formInputClassName)}
      required={required}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      {optionsWithCurrent(COUNTRY_OPTIONS, value).map((option) => (
        <option key={option.value} value={option.value}>
          {countryOptionLabel(option, lang)}
        </option>
      ))}
    </NativeComboboxSelect>
  );
}

export function NationalitySelect({
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const { lang } = useLang();
  return (
    <NativeComboboxSelect
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn("w-full", formInputClassName)}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      {optionsWithCurrent(NATIONALITY_OPTIONS, value).map((option) => (
        <option key={option.value} value={option.value}>
          {nationalityOptionLabel(option, lang)}
        </option>
      ))}
    </NativeComboboxSelect>
  );
}

export function LanguageChips({
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <LanguageMultiSelect
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={cn("w-full", formInputClassName)}
    />
  );
}

// Patient-specific: functional label chips.
// Kept here because the label dictionary is patient-domain.

export function parseFunctionalLabels(value: string): string[] {
  return value.split(",").flatMap((item) => {
    const normalized = normalizeFunctionalLabel(item);
    return normalized ? [normalized] : [];
  });
}

type FunctionalLabelLang = "de" | "ru" | "en";

type FunctionalLabelMeta = {
  labelKey: string;
  className: string;
};

const FUNCTIONAL_LABEL_META: Record<string, FunctionalLabelMeta> = {
  vip: {
    labelKey: "patients_functional_label_vip",
    className: "border-amber-300 bg-amber-50 text-amber-800",
  },
  high_risk: {
    labelKey: "patients_functional_label_high_risk",
    className: "border-rose-300 bg-rose-50 text-rose-700",
  },
  mobility_support: {
    labelKey: "patients_functional_label_mobility_support",
    className: "border-sky-300 bg-sky-50 text-sky-700",
  },
  fall_risk: {
    labelKey: "patients_functional_label_fall_risk",
    className: "border-orange-300 bg-orange-50 text-orange-700",
  },
  complex_coordination: {
    labelKey: "patients_functional_label_complex_coordination",
    className: "border-violet-300 bg-violet-50 text-violet-700",
  },
};

export function normalizeFunctionalLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function humanizeFunctionalLabel(
  value: string,
  lang: FunctionalLabelLang = getLang(),
): string {
  const normalized = normalizeFunctionalLabel(value);
  const meta = FUNCTIONAL_LABEL_META[normalized];
  if (meta) return uiText(meta.labelKey, lang === "de" ? "de" : "ru");
  const translations = translateCatalog(lang === "de" ? "de" : "ru");
  return formatUnknownValue(value, translations);
}

export function functionalLabelChipClass(value: string): string {
  return (
    FUNCTIONAL_LABEL_META[normalizeFunctionalLabel(value)]?.className ??
    "border-border bg-muted text-muted-foreground"
  );
}

function functionalLabelOptions(lang: FunctionalLabelLang): { value: string; label: string }[] {
  return Object.keys(FUNCTIONAL_LABEL_META).map((value) => ({
    value,
    label: humanizeFunctionalLabel(value, lang),
  }));
}

export function FunctionalLabelChips({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { lang } = useLang();
  const options = functionalLabelOptions(lang);
  const selected = parseFunctionalLabels(value);
  const toggle = (v: string) => {
    const next = selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v];
    onChange(next.join(", "));
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const checked = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            disabled={disabled}
            className={cn(
              "h-7 rounded-full border px-2.5 text-[12px] font-medium transition-colors",
              checked
                ? functionalLabelChipClass(opt.value)
                : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30",
              disabled && "cursor-default opacity-80 hover:text-muted-foreground hover:border-border",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
