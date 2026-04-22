import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { tokens } from "../primitives/design-tokens";

export function StatCard({
  label,
  value,
  description,
}: {
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl px-4 py-3", tokens.surface.card)}>
      <p className={tokens.text.eyebrow}>{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      {description ? (
        <p className={cn("mt-1", tokens.text.muted)}>{description}</p>
      ) : null}
    </div>
  );
}
