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
  label: string;
};

const COUNTRY_OPTIONS: PatientSelectOption[] = [
  { value: "Germany", label: "Germany" },
  { value: "Ukraine", label: "Ukraine" },
  { value: "Austria", label: "Austria" },
  { value: "Switzerland", label: "Switzerland" },
  { value: "Poland", label: "Poland" },
  { value: "Czech Republic", label: "Czech Republic" },
  { value: "Denmark", label: "Denmark" },
  { value: "Latvia", label: "Latvia" },
  { value: "Greece", label: "Greece" },
  { value: "Turkey", label: "Turkey" },
  { value: "United Arab Emirates", label: "United Arab Emirates" },
  { value: "Saudi Arabia", label: "Saudi Arabia" },
  { value: "Egypt", label: "Egypt" },
  { value: "Nigeria", label: "Nigeria" },
  { value: "Ghana", label: "Ghana" },
  { value: "Brazil", label: "Brazil" },
  { value: "China", label: "China" },
  { value: "Russia", label: "Russia" },
  { value: "Pakistan", label: "Pakistan" },
  { value: "United Kingdom", label: "United Kingdom" },
  { value: "United States", label: "United States" },
];

const NATIONALITY_OPTIONS: PatientSelectOption[] = [
  { value: "German", label: "German" },
  { value: "Ukrainian", label: "Ukrainian" },
  { value: "Austrian", label: "Austrian" },
  { value: "Swiss", label: "Swiss" },
  { value: "Polish", label: "Polish" },
  { value: "Czech", label: "Czech" },
  { value: "Danish", label: "Danish" },
  { value: "Latvian", label: "Latvian" },
  { value: "Greek", label: "Greek" },
  { value: "Turkish", label: "Turkish" },
  { value: "Emirati", label: "Emirati" },
  { value: "Saudi", label: "Saudi" },
  { value: "Egyptian", label: "Egyptian" },
  { value: "Nigerian", label: "Nigerian" },
  { value: "Ghanaian", label: "Ghanaian" },
  { value: "Brazilian", label: "Brazilian" },
  { value: "Chinese", label: "Chinese" },
  { value: "Russian", label: "Russian" },
  { value: "Pakistani", label: "Pakistani" },
  { value: "British", label: "British" },
  { value: "American", label: "American" },
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
  return [{ value: trimmed, label: trimmed }, ...options];
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
          {option.label}
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
          {option.label}
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
