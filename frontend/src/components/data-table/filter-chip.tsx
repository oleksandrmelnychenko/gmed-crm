import { ChevronDown, X } from "lucide-react";
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type FilterChipProps = {
  label: string;
  operator?: string;
  value?: ReactNode;
  onClick?: () => void;
  onClear?: () => void;
  active?: boolean;
  disabled?: boolean;
  removeLabel?: string;
  className?: string;
};

export function FilterChip({
  label,
  operator,
  value,
  onClick,
  onClear,
  active = false,
  disabled = false,
  removeLabel = "Remove filter",
  className,
}: FilterChipProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center overflow-hidden rounded-md border text-xs",
        active ? "border-primary bg-primary/5" : "border-border bg-muted",
        disabled && "opacity-50",
        className,
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-expanded={active || undefined}
        className="flex items-center gap-1 px-2 py-1 hover:bg-muted-foreground/10 disabled:hover:bg-transparent"
      >
        <span className="font-medium">{label}</span>
        {operator ? <span className="text-muted-foreground">{operator}</span> : null}
        {value ? <span className="font-medium">{value}</span> : null}
        {onClick ? <ChevronDown className="size-3 text-muted-foreground" /> : null}
      </button>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={removeLabel}
          title={removeLabel}
          className="flex h-full items-center border-l border-border px-1.5 text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
