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
      data-slot="row-expand-button"
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-foreground shadow-none transition-colors duration-150 outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
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
        strokeWidth={2}
        aria-hidden="true"
      />
    </button>
  );
}
