import { type ReactNode } from "react";
import { LoaderCircle, type LucideIcon } from "lucide-react";

import { CountBadge } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type MetricTone = "sky" | "emerald" | "amber" | "slate" | "rose";

export function AdminToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative z-30 flex w-full flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card/80 p-2 shadow-sm",
        "[&_[data-slot=input]]:bg-background [&_[data-slot=input]]:text-[13px]",
        "[&_[data-slot=select-trigger]]:bg-background [&_[data-slot=select-trigger]]:text-[13px]",
        className,
      )}
    >
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
  void tone;
  const hasLabel = Boolean(label);
  const hasDescription = Boolean(description);
  const hasTwoLabels = hasLabel && hasDescription;
  const singleLabel = hasLabel ? label : description;

  return (
    <article
      className={cn(
        "relative min-w-[190px] flex-1 px-3 py-1",
        hasTwoLabels ? "min-h-[68px]" : "min-h-[44px]",
      )}
    >
      <span className="admin-inline-metric-separator absolute right-0 top-1/2 hidden -translate-y-1/2 space-y-1">
        <span className="block h-1.5 w-px bg-border" />
        <span className="block h-1.5 w-px bg-border" />
        <span className="block h-1.5 w-px bg-border" />
      </span>
      <div className="flex items-baseline gap-2">
        <Icon className="size-4.5 shrink-0 text-muted-foreground/55" />
        <p className="text-2xl font-semibold leading-[0.75] text-foreground">
          {value}
        </p>
      </div>
      {hasTwoLabels ? (
        <>
          <p className="mt-[4px] line-clamp-2 text-[11px] leading-tight text-muted-foreground/75">
            {description}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs font-medium leading-tight text-muted-foreground">
            {label}
          </p>
        </>
      ) : singleLabel ? (
        <p className="mt-0.5 line-clamp-2 text-xs font-medium leading-tight text-muted-foreground">
          {singleLabel}
        </p>
      ) : null}
    </article>
  );
}

export function AdminTableCard({
  title,
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
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {count !== undefined ? <CountBadge>{count}</CountBadge> : null}
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
  headerClassName,
  bodyClassName,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
}) {
  void description;

  return (
    <div className={cn("flex flex-1 min-h-0 flex-col", className)}>
      <SheetHeader className={cn("shrink-0 px-4 pt-3 pb-1", headerClassName)}>
        <SheetTitle>{title}</SheetTitle>
      </SheetHeader>
      <div
        className={cn("flex-1 overflow-y-auto px-4 py-2 space-y-4", bodyClassName)}
      >
        {children}
      </div>
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
  onSubmit,
}: {
  cancelLabel: ReactNode;
  submitLabel: ReactNode;
  submittingLabel?: ReactNode;
  submitting?: boolean;
  submitDisabled?: boolean;
  onCancel: () => void;
  onSubmit?: () => void;
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
      <Button
        type={onSubmit ? "button" : "submit"}
        className="h-9 rounded-lg"
        disabled={submitting || submitDisabled}
        onClick={onSubmit}
      >
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
