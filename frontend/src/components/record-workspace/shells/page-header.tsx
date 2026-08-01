import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, actions }: PageHeaderProps) {
  // Lazy init covers client-side navigations (slot already in DOM); the
  // effect covers the very first app render where the shell commits together
  // with the page. One-time DOM sync for the portal target.
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.getElementById("topbar-page-slot"),
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTopbarSlot(document.getElementById("topbar-page-slot"));
  }, []);

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-3",
          topbarSlot && "lg:hidden",
        )}
      >
        <div className="min-w-0 space-y-1">
          <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {topbarSlot
        ? createPortal(
            <div className="flex h-9 w-fit max-w-full min-w-0 items-center gap-3 rounded-lg border border-border/50 bg-muted/25 px-2.5">
              <h1 className="min-w-0 truncate text-[15px] font-medium tracking-tight text-foreground">
                {title}
              </h1>
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
