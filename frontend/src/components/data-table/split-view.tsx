import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { useLang } from "@/lib/i18n";
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
  paneLabel,
  closeLabel,
  className,
}: SplitViewProps) {
  const { t } = useLang();
  const responsiveMode = useResponsiveViewMode();
  const mode = explicitMode ?? responsiveMode;
  const resolvedPaneLabel = paneLabel ?? t.common_detail;
  const resolvedCloseLabel = closeLabel ?? t.common_close;

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
            aria-label={resolvedPaneLabel}
            className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
            style={{ width: paneWidth }}
          >
            {onClose ? (
              <div className="flex items-center justify-end border-b border-border px-2 py-1">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={resolvedCloseLabel}
                  title={resolvedCloseLabel}
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
        <div className="fixed inset-0 z-40 flex items-stretch justify-end">
          <button
            type="button"
            aria-label={resolvedCloseLabel}
            className="absolute inset-0 bg-foreground/20"
            onClick={() => onClose?.()}
          />
          <aside
            aria-label={resolvedPaneLabel}
            role="dialog"
            className="relative flex w-full max-w-md flex-col overflow-hidden border-l border-border bg-card shadow-2xl sm:max-w-lg"
          >
            {onClose ? (
              <div className="flex items-center justify-end border-b border-border px-2 py-1">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={resolvedCloseLabel}
                  title={resolvedCloseLabel}
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
