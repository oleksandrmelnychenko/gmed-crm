import { getLang, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  CountBadge,
  EmptyCell,
  Field,
  Section as FormSection,
  TabLoader,
  inputClass,
  textareaClass,
} from "@/components/ui-shell";

// Re-export shell primitives so existing screens keep working.
// New code should import from "@/components/ui-shell" directly.
export { CountBadge, EmptyCell, Field, FormSection, TabLoader };

export const formInputClassName = inputClass;
export const textareaClassName = textareaClass;

// Patient-specific: functional label chips.
// Kept here because the label dictionary is patient-domain.

export function parseFunctionalLabels(value: string): string[] {
  return value
    .split(",")
    .map(normalizeFunctionalLabel)
    .filter(Boolean);
}

type FunctionalLabelLang = "de" | "ru" | "en";

type FunctionalLabelMeta = {
  de: string;
  ru: string;
  en: string;
  className: string;
};

const FUNCTIONAL_LABEL_META: Record<string, FunctionalLabelMeta> = {
  vip: {
    de: "VIP",
    ru: "VIP",
    en: "VIP",
    className: "border-amber-300 bg-amber-50 text-amber-800",
  },
  high_risk: {
    de: "Hohes Risiko",
    ru: "Высокий риск",
    en: "High risk",
    className: "border-rose-300 bg-rose-50 text-rose-700",
  },
  mobility_support: {
    de: "Mobilitätshilfe",
    ru: "Помощь с мобильностью",
    en: "Mobility support",
    className: "border-sky-300 bg-sky-50 text-sky-700",
  },
  fall_risk: {
    de: "Sturzrisiko",
    ru: "Риск падения",
    en: "Fall risk",
    className: "border-orange-300 bg-orange-50 text-orange-700",
  },
  complex_coordination: {
    de: "Komplexe Koordination",
    ru: "Сложная координация",
    en: "Complex coordination",
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
  if (meta) return meta[lang] ?? meta.ru;
  return value.replaceAll("_", " ");
}

export function functionalLabelChipClass(value: string): string {
  return (
    FUNCTIONAL_LABEL_META[normalizeFunctionalLabel(value)]?.className ??
    "border-border bg-muted text-muted-foreground"
  );
}

export function functionalLabelOptions(lang: FunctionalLabelLang): { value: string; label: string }[] {
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
