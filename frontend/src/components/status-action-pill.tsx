import { useEffect, useRef, useState } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

type StatusActionPillProps = {
  isActive: boolean;
  onToggle: () => Promise<void>;
  activeLabel: string;
  inactiveLabel: string;
  toggleActiveLabel: string;
  toggleInactiveLabel: string;
  className?: string;
};

export function StatusActionPill({
  isActive,
  onToggle,
  activeLabel,
  inactiveLabel,
  toggleActiveLabel,
  toggleInactiveLabel,
  className,
}: StatusActionPillProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handle(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handle);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", handle);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-colors",
          isActive
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
        )}
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            isActive ? "bg-emerald-500" : "bg-muted-foreground/60"
          )}
        />
        {isActive ? activeLabel : inactiveLabel}
        <ChevronDown className="size-3" />
      </button>
      {open ? (
        <div
          onClick={(event) => event.stopPropagation()}
          className="absolute left-0 top-full z-30 mt-1 w-[220px] rounded-lg border border-border bg-popover p-1.5 shadow-md"
        >
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onToggle();
              } finally {
                setBusy(false);
                setOpen(false);
              }
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors disabled:opacity-50",
              isActive
                ? "text-rose-700 hover:bg-rose-50"
                : "text-emerald-700 hover:bg-emerald-50"
            )}
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {isActive ? toggleActiveLabel : toggleInactiveLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
