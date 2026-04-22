import { type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function CountBadge({ children }: { children: ReactNode }) {
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full border-border/60 bg-muted/25 text-foreground")}
    >
      {children}
    </Badge>
  );
}
