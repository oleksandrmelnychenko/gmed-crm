import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { tokens } from "../primitives/design-tokens";

export function Section({
  title,
  accessory,
  children,
  className,
}: {
  title: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "space-y-3 rounded-xl p-3.5",
        tokens.surface.softCard,
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className={cn(tokens.text.sectionTitle, "truncate")}>{title}</h3>
        </div>
        {accessory ? <div className="min-w-0 max-w-full">{accessory}</div> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
