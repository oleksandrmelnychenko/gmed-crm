import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

// The top bar shows `#topbar-page-slot` from Tailwind `lg` up; below it the
// in-page title is the visible one.
const TOPBAR_TITLE_QUERY = "(min-width: 1024px)";
// Room the top-bar copy needs besides its actions: a readable (truncated)
// title, the gap and the copy's padding and border.
const TOPBAR_MIN_TITLE_WIDTH = 120;
const TOPBAR_COPY_CHROME_WIDTH = 34;

function subscribeTopbarTitleQuery(onChange: () => void) {
  const query = typeof window === "undefined" ? undefined : window.matchMedia?.(TOPBAR_TITLE_QUERY);
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

function topbarTitleQueryMatches() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(TOPBAR_TITLE_QUERY).matches);
}

export function PageHeader({ title, actions }: PageHeaderProps) {
  // Lazy init covers client-side navigations (slot already in DOM); the
  // layout effect covers the very first app render where the shell commits
  // together with the page. One-time DOM sync for the portal target. It runs
  // before paint: a passive effect let the in-page actions show for a frame
  // on desktop and then hid them, so a click aimed at them could land on the
  // copy that was about to disappear.
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.getElementById("topbar-page-slot"),
  );
  const topbarTitleShown = useSyncExternalStore(
    subscribeTopbarTitleQuery,
    topbarTitleQueryMatches,
    () => false,
  );
  // Whether the actions fit next to the title in the top bar. When they do
  // not, they stay in the page (wrapping there) instead of being drawn over
  // the bell and the language switch (QA 2026-10-11, patient dashboard).
  const [actionsFitTopbar, setActionsFitTopbar] = useState(true);
  const topbarActionsRef = useRef<HTMLDivElement>(null);
  const hasActions = Boolean(actions);

  useLayoutEffect(() => {
    setTopbarSlot(document.getElementById("topbar-page-slot"));
  }, []);

  useLayoutEffect(() => {
    const actionsElement = topbarActionsRef.current;
    if (!topbarSlot || !hasActions || !actionsElement) return;
    // The slot takes the bar's free width whatever it holds, and the hidden
    // actions keep their natural width (`w-max`, out of flow): the check
    // cannot flip its own result.
    const measure = () => {
      const needed = actionsElement.scrollWidth + TOPBAR_MIN_TITLE_WIDTH + TOPBAR_COPY_CHROME_WIDTH;
      setActionsFitTopbar(needed <= topbarSlot.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(topbarSlot);
    observer.observe(actionsElement);
    return () => observer.disconnect();
  }, [hasActions, topbarSlot]);

  // Exactly one <h1> in the DOM: the copy the current viewport shows.
  const topbarOwnsHeading = Boolean(topbarSlot) && topbarTitleShown;
  const InPageTitle = topbarOwnsHeading ? "div" : "h1";
  const TopbarTitle = topbarOwnsHeading ? "h1" : "div";
  const actionsInTopbar = hasActions && actionsFitTopbar;

  return (
    <>
      <div
        className={cn(
          "flex flex-col items-stretch gap-3 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between",
          topbarSlot && (actionsInTopbar || !hasActions) && "lg:hidden",
          topbarSlot && hasActions && !actionsFitTopbar && "lg:justify-end",
        )}
      >
        <div className={cn("min-w-0 space-y-1", topbarSlot && "lg:hidden")}>
          <InPageTitle className="min-w-0 truncate text-lg font-semibold tracking-tight text-foreground">{title}</InPageTitle>
        </div>
        {actions ? (
          <div className="grid w-full grid-cols-2 items-center gap-2 lg:flex lg:w-auto lg:flex-wrap max-lg:[&>*]:min-w-0 max-lg:[&>[data-slot=badge]]:col-span-2 max-lg:[&>[data-slot=badge]]:h-auto max-lg:[&>[data-slot=badge]]:min-h-6 max-lg:[&>[data-slot=badge]]:w-full max-lg:[&>[data-slot=badge]]:whitespace-normal max-lg:[&>button:only-child]:col-span-2 max-lg:[&_:is(button,a)]:min-h-10">{actions}</div>
        ) : null}
      </div>
      {topbarSlot
        ? createPortal(
            <div
              className={cn(
                "relative flex h-9 w-fit max-w-full min-w-0 items-center gap-3 rounded-lg border border-border/50 bg-muted/25 px-2.5",
                // The hidden actions are only measured; they must not widen the bar.
                hasActions && !actionsInTopbar && "overflow-hidden",
              )}
            >
              <TopbarTitle className="min-w-0 truncate text-[15px] font-medium tracking-tight text-foreground">
                {title}
              </TopbarTitle>
              {actions ? (
                <div
                  ref={topbarActionsRef}
                  aria-hidden={actionsInTopbar ? undefined : true}
                  inert={!actionsInTopbar}
                  className={cn(
                    "flex w-max shrink-0 items-center gap-2 [&_:is(button,a,select)]:h-7 [&_:is(button,a,select)]:rounded-md [&_:is(button,a,select)]:text-xs [&_:is(button,a)]:px-2.5 [&_:is(button,a)_svg]:size-3.5 [&_select]:py-0",
                    !actionsInTopbar && "pointer-events-none invisible absolute left-0 top-0",
                  )}
                >
                  {actions}
                </div>
              ) : null}
            </div>,
            topbarSlot,
          )
        : null}
    </>
  );
}
