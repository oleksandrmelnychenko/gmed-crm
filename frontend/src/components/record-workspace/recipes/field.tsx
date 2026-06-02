import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { tokens } from "../primitives/design-tokens";

export function Field({
  label,
  htmlFor,
  children,
  className,
  required,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className={cn(tokens.text.label, "block")}>
        {label}
        {required ? (
          <span aria-hidden className="ml-1 text-destructive">
            *
          </span>
        ) : null}
      </label>
      {children}
    </div>
  );
}
