import { useLang } from "@/lib/i18n";
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
    .map((item) => item.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_"))
    .filter(Boolean);
}

export function humanizeFunctionalLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export function FunctionalLabelChips({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { lang } = useLang();
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;
  const options: { value: string; label: string }[] = [
    { value: "vip", label: "VIP" },
    { value: "high_risk", label: l("Hohes Risiko", "Высокий риск", "High risk") },
    { value: "mobility_support", label: l("Mobilitätshilfe", "Помощь с мобильностью", "Mobility support") },
    { value: "fall_risk", label: l("Sturzrisiko", "Риск падения", "Fall risk") },
    { value: "complex_coordination", label: l("Komplexe Koordination", "Сложная координация", "Complex coordination") },
  ];
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
                ? "bg-[var(--brand)] text-white border-[var(--brand)]"
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
