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

// Re-export shell primitives so existing screens keep working.
// New code should import from "@/components/ui-shell" directly.
export { Field, FormSection };

export const formInputClassName = inputClass;
export const textareaClassName = textareaClass;

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
}: {
  value: string;
  onChange: (next: string) => void;
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
            className={cn(
              "h-7 rounded-full border px-2.5 text-[12px] font-medium transition-colors",
              checked
                ? functionalLabelChipClass(opt.value)
                : "bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
