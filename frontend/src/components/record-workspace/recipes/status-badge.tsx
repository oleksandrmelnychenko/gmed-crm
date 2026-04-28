import { type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { STATUS_TONE, type StatusTone, toneForStatus } from "../primitives/status-tones";

export function StatusBadge({
  status,
  tone,
  children,
  className,
}: {
  status?: string;
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  const resolvedTone = tone ?? toneForStatus(status);

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full font-mono text-[10px] font-semibold uppercase tracking-[0.03em]",
        STATUS_TONE[resolvedTone],
        className,
      )}
    >
      {children}
    </Badge>
  );
}
