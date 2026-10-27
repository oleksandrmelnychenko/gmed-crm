import type { ComponentProps, ReactNode } from "react";
import { CalendarDays, CheckCircle2 } from "lucide-react";
import { InfoRow, ListItem, Section, StatCard } from "@/components/ui-shell";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

/** The same card, border and heading rhythm as the staff workspace. */
export function PortalSection({ className, ...props }: ComponentProps<typeof Section>) {
  return <Section {...props} className={cn("min-w-0 rounded-xl border border-border/70 bg-card p-3 sm:p-4 [&_label.block]:font-mono [&_label.block]:text-xs", className)} />;
}

export function PortalInfoRow({ className, ...props }: ComponentProps<typeof InfoRow>) {
  return <InfoRow {...props} className={cn(className, "min-w-0 rounded-lg border-0 bg-muted/20 px-3 py-2 shadow-none [&>span:first-child]:font-mono [&>span:first-child]:text-xs [&>span:last-of-type]:text-sm [&>span]:[overflow-wrap:anywhere]")} />;
}

export function PortalListItem({ className, ...props }: ComponentProps<typeof ListItem>) {
  return <ListItem {...props} className={cn("min-w-0 rounded-xl border-border/60 bg-card p-3 shadow-none", className)} />;
}

export function PortalStatCard({ label, value, description }: ComponentProps<typeof StatCard>) {
  return <div className="min-w-0 rounded-xl border border-border/60 bg-card px-3 py-2.5">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <span className="font-mono text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums text-foreground">{value}</span>
    </div>
    {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
  </div>;
}

export function PortalDateChip({ children }: { children: ReactNode }) {
  if (!children || children === "—" || children === "–") return <span>{children || "—"}</span>;
  return <StatusChip tone="info"><CalendarDays aria-hidden="true" /><span className="min-w-0 whitespace-normal">{children}</span></StatusChip>;
}

export function PortalSummary({ items }: { items: { label: string; value: ReactNode; visible: boolean }[] }) {
  const visible = items.filter((item) => item.visible);
  if (!visible.length) return null;
  return <dl className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-border/60 bg-card px-3 py-2.5">
    {visible.map((item) => <div key={item.label} className="flex items-baseline gap-2 text-sm">
      <dt className="font-mono text-xs text-muted-foreground">{item.label}</dt>
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
