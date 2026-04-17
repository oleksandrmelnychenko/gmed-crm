import { type ReactNode } from "react";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const formInputClassName = "h-9 rounded-lg bg-card";

export const textareaClassName =
  "min-h-[80px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {label}
      </span>
      {children}
    </label>
  );
}

export function FormSection({
  title,
  accessory,
  children,
}: {
  title: string;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="text-[13px] font-semibold tracking-tight text-foreground truncate">
            {title}
          </h3>
        </div>
        {accessory ? <div className="shrink-0">{accessory}</div> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

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
