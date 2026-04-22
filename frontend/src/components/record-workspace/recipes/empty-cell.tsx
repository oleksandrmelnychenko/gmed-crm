import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { tokens } from "../primitives/design-tokens";

export function EmptyCell({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-8 text-center text-sm text-muted-foreground",
        tokens.surface.dashed,
      )}
    >
      {children}
    </div>
  );
}
