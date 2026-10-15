import type { ComponentProps, ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { Section } from "@/components/ui-shell";
import { cn } from "@/lib/utils";

/** The same card, border and heading rhythm as the staff workspace. */
export function PortalSection({ className, ...props }: ComponentProps<typeof Section>) {
  return <Section {...props} className={cn("min-w-0 rounded-xl border border-border/70 bg-card p-4 sm:p-5", className)} />;
}

export function PortalSummary({ items }: { items: { label: string; value: ReactNode; visible: boolean }[] }) {
  const visible = items.filter((item) => item.visible);
  if (!visible.length) return null;
  return <dl className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
    {visible.map((item) => <div key={item.label} className="flex items-baseline gap-2 text-sm">
      <dt className="text-muted-foreground">{item.label}</dt>
      <dd className="font-semibold tabular-nums text-foreground">{item.value}</dd>
    </div>)}
  </dl>;
}

export function PortalComplete({ children }: { children: ReactNode }) {
  return <div className="flex items-start gap-2 text-sm text-foreground">
    <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
    <span>{children}</span>
  </div>;
}
