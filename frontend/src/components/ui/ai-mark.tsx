import { forwardRef, type ComponentProps } from "react";
import { Sparkles, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export const AiMark: LucideIcon = forwardRef<SVGSVGElement, ComponentProps<"svg">>(function AiMark(
  { className, ...props },
  ref,
) {
  return (
    <Sparkles
      {...props}
      ref={ref}
      aria-hidden="true"
      data-ai-mark="true"
      strokeWidth={1.65}
      className={cn("size-4 shrink-0 text-current", className)}
    />
  );
});
