import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
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
  // effect covers the very first app render where the shell commits together
  // with the page. One-time DOM sync for the portal target.
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.getElementById("topbar-page-slot"),
  );
  const topbarTitleShown = useSyncExternalStore(
    subscribeTopbarTitleQuery,
    topbarTitleQueryMatches,
    () => false,
  );

  useEffect(() => {
    setTopbarSlot(document.getElementById("topbar-page-slot"));
  }, []);

  // Exactly one <h1> in the DOM: the copy the current viewport shows.
  const topbarOwnsHeading = Boolean(topbarSlot) && topbarTitleShown;
  const InPageTitle = topbarOwnsHeading ? "div" : "h1";
  const TopbarTitle = topbarOwnsHeading ? "h1" : "div";

  return (
    <>
      <div
        className={cn(
          "flex flex-col items-stretch gap-3 lg:flex-row lg:flex-wrap lg:items-start lg:justify-between",
          topbarSlot && "lg:hidden",
        )}
      >
        <div className="min-w-0 space-y-1">
          <InPageTitle className="min-w-0 truncate text-lg font-semibold tracking-tight text-foreground">{title}</InPageTitle>
        </div>
        {actions ? (
          <div className="grid w-full grid-cols-2 items-center gap-2 lg:flex lg:w-auto lg:flex-wrap max-lg:[&>*]:min-w-0 max-lg:[&>[data-slot=badge]]:col-span-2 max-lg:[&>[data-slot=badge]]:h-auto max-lg:[&>[data-slot=badge]]:min-h-6 max-lg:[&>[data-slot=badge]]:w-full max-lg:[&>[data-slot=badge]]:whitespace-normal max-lg:[&>button:only-child]:col-span-2 max-lg:[&_:is(button,a)]:min-h-10">{actions}</div>
        ) : null}
      </div>
      {topbarSlot
        ? createPortal(
            <div className="flex h-9 w-fit max-w-full min-w-0 items-center gap-3 rounded-lg border border-border/50 bg-muted/25 px-2.5">
              <TopbarTitle className="min-w-0 truncate text-[15px] font-medium tracking-tight text-foreground">
                {title}
              </TopbarTitle>
              {actions ? (
                <div className="flex shrink-0 items-center gap-2 [&_:is(button,a,select)]:h-7 [&_:is(button,a,select)]:rounded-md [&_:is(button,a,select)]:text-xs [&_:is(button,a)]:px-2.5 [&_:is(button,a)_svg]:size-3.5 [&_select]:py-0">
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
