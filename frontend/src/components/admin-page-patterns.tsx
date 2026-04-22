import { type ReactNode } from "react";
import { LoaderCircle, type LucideIcon } from "lucide-react";

import { CountBadge } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type MetricTone = "sky" | "emerald" | "amber" | "slate" | "rose";

const METRIC_TONE_CLASS: Record<MetricTone, string> = {
  sky: "bg-sky-100 text-sky-700",
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  slate: "bg-slate-100 text-slate-700",
  rose: "bg-rose-100 text-rose-700",
};

export function AdminToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      {children}
    </div>
  );
}

export function AdminInlineMetric({
  icon: Icon,
  label,
  value,
  description,
  tone = "slate",
}: {
  icon: LucideIcon;
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  tone?: MetricTone;
}) {
  return (
    <div className="flex min-w-[170px] items-center gap-3">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-2xl",
          METRIC_TONE_CLASS[tone],
        )}
      >
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0">
        <span className="text-[12px] text-muted-foreground">{label}</span>
        <p className="mt-1 text-[20px] font-semibold tracking-tight text-foreground leading-none">
          {value}
        </p>
        {description ? (
          <p className="mt-1 text-[11.5px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}

export function AdminTableCard({
  title,
  description,
  count,
  accessory,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  count?: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card overflow-hidden",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
              {title}
            </h3>
            {count !== undefined ? <CountBadge>{count}</CountBadge> : null}
          </div>
          {description ? (
            <p className="text-[12px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {accessory ? <div className="shrink-0">{accessory}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function AdminSheetScaffold({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-1 min-h-0 flex-col", className)}>
      <SheetHeader className="shrink-0 px-4 pt-3 pb-1">
        <SheetTitle>{title}</SheetTitle>
        {description ? <SheetDescription>{description}</SheetDescription> : null}
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">{children}</div>
      {footer}
    </div>
  );
}

export function SheetFormFooter({
  cancelLabel,
  submitLabel,
  submittingLabel,
  submitting = false,
  submitDisabled = false,
  onCancel,
}: {
  cancelLabel: ReactNode;
  submitLabel: ReactNode;
  submittingLabel?: ReactNode;
  submitting?: boolean;
  submitDisabled?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="shrink-0 flex justify-end gap-2 bg-popover px-4 py-3">
      <Button
        type="button"
        variant="outline"
        className="h-9 rounded-lg"
        onClick={onCancel}
        disabled={submitting}
      >
        {cancelLabel}
      </Button>
      <Button type="submit" className="h-9 rounded-lg" disabled={submitting || submitDisabled}>
        {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {submitting ? (submittingLabel ?? submitLabel) : submitLabel}
      </Button>
    </div>
  );
}

export function SheetActionsFooter({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 flex justify-end gap-2 bg-popover px-4 py-3">
      {children}
    </div>
  );
}
