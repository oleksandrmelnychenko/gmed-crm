import { Rows2, Rows3, Rows4 } from "lucide-react";

import { cn } from "@/lib/utils";

import type { DensityLevel } from "./types";

export type DensityOption = {
  value: DensityLevel;
  label: string;
  icon: typeof Rows3;
};

const DEFAULT_OPTIONS: readonly DensityOption[] = [
  { value: "comfortable", label: "Comfortable", icon: Rows2 },
  { value: "compact", label: "Compact", icon: Rows3 },
  { value: "condensed", label: "Condensed", icon: Rows4 },
];

export type DensityToggleProps = {
  value: DensityLevel;
  onChange: (value: DensityLevel) => void;
  options?: readonly DensityOption[];
  labels?: Partial<Record<DensityLevel, string>>;
  className?: string;
  ariaLabel?: string;
};

export function DensityToggle({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  labels,
  className,
  ariaLabel = "Row density",
}: DensityToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-background p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        const label = labels?.[option.value] ?? option.label;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            data-density-value={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-6 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              selected && "bg-foreground text-background shadow-sm hover:bg-foreground hover:text-background",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}

export const DENSITY_ROW_HEIGHT: Record<DensityLevel, number> = {
  comfortable: 44,
  compact: 36,
  condensed: 28,
};
