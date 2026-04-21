import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import type { ViewMode } from "./types";
import { useResponsiveViewMode } from "./use-responsive-view-mode";

export type SplitViewProps = {
  viewMode?: ViewMode;
  active: boolean;
  pane: ReactNode;
  children: ReactNode;
  onClose?: () => void;
  paneWidth?: number;
  paneLabel?: string;
  closeLabel?: string;
  className?: string;
};

export function SplitView({
  viewMode: explicitMode,
  active,
  pane,
  children,
  onClose,
  paneWidth = 480,
  paneLabel = "Detail",
  closeLabel = "Close",
  className,
}: SplitViewProps) {
  const responsiveMode = useResponsiveViewMode();
  const mode = explicitMode ?? responsiveMode;

  useEffect(() => {
    if (!active || !onClose) return;
    if (typeof window === "undefined") return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [active, onClose]);

  if (mode === "split") {
    return (
      <div className={cn("flex min-h-0 flex-1 gap-3", className)}>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        {active ? (
          <aside
            aria-label={paneLabel}
            className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
            style={{ width: paneWidth }}
          >
            {onClose ? (
              <div className="flex items-center justify-end border-b border-border px-2 py-1">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={closeLabel}
                  title={closeLabel}
                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : null}
            <div className="flex-1 overflow-y-auto">{pane}</div>
          </aside>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {children}
      {active ? (
        <div
          className="fixed inset-0 z-40 flex items-stretch justify-end"
          onClick={() => onClose?.()}
        >
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-foreground/20"
          />
          <aside
            aria-label={paneLabel}
            role="dialog"
            className="relative flex w-full max-w-md flex-col overflow-hidden border-l border-border bg-card shadow-2xl sm:max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {onClose ? (
              <div className="flex items-center justify-end border-b border-border px-2 py-1">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={closeLabel}
                  title={closeLabel}
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : null}
            <div className="flex-1 overflow-y-auto">{pane}</div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
