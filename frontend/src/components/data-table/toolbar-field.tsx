import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Wraps a toolbar control with the same micro-label style as the providers
 * people catalog (FieldLabel) so single-row toolbars stay self-documenting.
 * Pair with `items-end` on the toolbar row so label-less controls (buttons,
 * builders) align with the control baseline.
 */
export function ToolbarField({
  label,
  className,
  children,
}: {
  label: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 shrink-0 flex-col", className)}>
      <span className="mb-0.5 flex h-4 min-w-0 items-center truncate text-[10px] font-medium leading-none text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
