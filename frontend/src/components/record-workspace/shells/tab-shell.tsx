import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function TabShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mt-4 min-h-[400px] space-y-4", className)}>{children}</div>
  );
}
