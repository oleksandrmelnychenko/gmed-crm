import type { ComponentProps, ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { InfoRow, ListItem, Section, StatCard } from "@/components/ui-shell";
import { cn } from "@/lib/utils";

/** Shared portal surfaces; colours come from the opt-in GMED theme. */
export function PortalSection({ className, ...props }: ComponentProps<typeof Section>) {
  return <Section {...props} className={cn("portal-section min-w-0 rounded-xl border border-border/70 bg-card p-3 [&_label.block]:font-mono [&_label.block]:text-xs", className)} />;
}

export function PortalInfoRow({ className, ...props }: ComponentProps<typeof InfoRow>) {
  return <InfoRow {...props} className={cn(className, "portal-info-row min-w-0 rounded-lg border border-border/50 bg-card px-3 py-2 shadow-none [&>span:first-child]:font-sans [&>span:first-child]:text-sm [&>span:last-of-type]:text-sm [&>span:last-of-type]:text-foreground [&>span]:[overflow-wrap:anywhere]")} />;
}

export function PortalListItem({ className, ...props }: ComponentProps<typeof ListItem>) {
  return <ListItem {...props} className={cn("portal-list-item min-w-0 rounded-xl border-border/60 bg-card p-3 shadow-none [overflow-wrap:anywhere]", className)} />;
}

export function PortalStatCard({ label, value, description }: ComponentProps<typeof StatCard>) {
  return <div className="min-w-0 rounded-xl border border-border/60 bg-card px-3 py-2.5">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
    </div>
    {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
  </div>;
}

export { PortalDateChip } from "@/components/ui/portal-date-chip";

export function PortalSummary({ items }: { items: { label: string; value: ReactNode; visible: boolean }[] }) {
  const visible = items.filter((item) => item.visible);
  if (!visible.length) return null;
  return <dl className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-border/60 bg-card px-3 py-2.5">
    {visible.map((item) => <div key={item.label} className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      <dt className="text-sm text-muted-foreground">{item.label}</dt>
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
