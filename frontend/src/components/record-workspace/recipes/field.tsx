import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { tokens } from "../primitives/design-tokens";

export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className={cn(tokens.text.label, "block")}>
        {label}
      </label>
      {children}
    </div>
  );
}
