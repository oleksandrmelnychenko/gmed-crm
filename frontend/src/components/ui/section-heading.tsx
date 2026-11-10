import type { ReactNode } from "react";
import { PanelsTopLeft, type LucideIcon } from "lucide-react";

export function SectionHeading({ children, icon: Icon = PanelsTopLeft }: { children: ReactNode; icon?: LucideIcon }) {
  return (
    <span data-slot="section-heading" className="inline-flex min-w-0 max-w-full items-center gap-2 align-middle font-sans text-[13px] leading-5 font-semibold tracking-tight text-foreground">
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
      <span aria-hidden="true" data-slot="heading-marker" className="size-1.5 shrink-0 rounded-full bg-[var(--dot,#ed6e2c)]" />
    </span>
  );
}
