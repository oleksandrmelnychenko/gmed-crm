import type { ElementType, ReactNode } from "react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { PERIOD_OPTIONS, type Period } from "../../model/staff-dashboard-types";

export type DashboardTranslations = Record<string, string>;

export function DashKpi({
  label,
  value,
  hint,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: ElementType;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative cursor-pointer overflow-hidden rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/30"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at top right, rgba(249,115,22,0.08), transparent 55%)",
        }}
      />
      <div className="relative flex items-start justify-between">
        <div>
          <span className="text-[12px] text-muted-foreground">{label}</span>
          <p className="mt-1.5 text-[24px] font-semibold leading-none tracking-tight text-foreground">
            {value}
          </p>
          {hint ? <p className="mt-2 text-[11px] text-muted-foreground">{hint}</p> : null}
        </div>
        <Icon className="size-[18px] text-muted-foreground" />
      </div>
    </button>
  );
}

export function QuickLink({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ElementType;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:border-foreground/30"
    >
      <div className="flex size-9 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{label}</div>
      </div>
      <ArrowRight className="size-3.5 text-muted-foreground" />
    </button>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === "completed" || status === "confirmed"
      ? "bg-emerald-500"
      : status === "cancelled"
        ? "bg-rose-500"
        : status === "blocked"
          ? "bg-amber-500"
          : "bg-sky-500";
  return <span className={cn("size-1.5 shrink-0 rounded-full", color)} />;
}

export function PriorityDot({ priority }: { priority: string }) {
  const color =
    priority === "high" || priority === "urgent"
      ? "bg-rose-500"
      : priority === "medium"
        ? "bg-amber-500"
        : "bg-emerald-500";
  return <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", color)} />;
}

export function ChartSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-border border-t-[var(--brand)]" />
    </div>
  );
}

export function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-[13px] text-muted-foreground">
      {label}
    </div>
  );
}

export function SectionHeader({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-1 mt-2 flex items-end justify-between px-1">
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </h2>
        {hint ? <p className="mt-0.5 text-[13px] text-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

export function ChartCard({
  title,
  hint,
  children,
  compact,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-border bg-card", compact ? "p-3" : "p-4")}>
      <div>
        <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
        {hint ? <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </div>
  );
}

export function PeriodSwitcher({
  value,
  onChange,
  tr,
}: {
  value: Period;
  onChange: (period: Period) => void;
  tr: DashboardTranslations;
}) {
  const labels: Record<Period, string> = {
    "7d": tr.dash_period_7d ?? "7d",
    "30d": tr.dash_period_30d ?? "30d",
    "90d": tr.dash_period_90d ?? "90d",
    "12m": tr.dash_period_12m ?? "12m",
    all: tr.dash_period_all ?? "All",
  };

  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 text-[12px]">
      {PERIOD_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "h-7 rounded-md px-2.5 transition-colors",
            value === option
              ? "bg-[var(--brand)] font-medium text-white"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}
