import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/** A visible, keyboard-accessible toggle that doesn't activate its table row. */
export function RowExpandButton({
  expanded,
  label,
  onToggle,
  testId,
}: {
  expanded: boolean;
  label: string;
  onToggle: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={cn(
        "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border shadow-xs transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1",
        expanded
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-foreground/20 bg-muted text-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
    >
      <ChevronRight
        className={cn("size-4 transition-transform duration-150 motion-reduce:transition-none", expanded && "rotate-90")}
        strokeWidth={2.5}
        aria-hidden="true"
      />
    </button>
  );
}
