import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import { LoaderCircle, type LucideIcon } from "lucide-react";

import { CountBadge } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import {
  SheetHeader,
  SheetTitle,
  useSheetDismissalGuard,
} from "@/components/ui/sheet";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useOverlaySaveDisabled } from "@/components/ui/dismissal-guard";

type MetricTone = "sky" | "emerald" | "amber" | "slate" | "rose";

const SHEET_BODY_WRAPPER_BASE_CLASS = "space-y-4 rounded-xl";

function resolveSheetBodyWrapperClassName({
  bodyWrapperClassName,
}: {
  bodyWrapperClassName?: string;
}) {
  return bodyWrapperClassName ?? SHEET_BODY_WRAPPER_BASE_CLASS;
}

function getSheetBodyWrapperElement(children: ReactNode) {
  const nodes = Children.toArray(children);

  if (nodes.length !== 1) return null;

  const [node] = nodes;

  if (!isValidElement<{ className?: unknown }>(node) || node.type !== "div") {
    return null;
  }

  const { className } = node.props;

  if (typeof className !== "string") return null;

  const hasSpacing = /\bspace-y-[234568]\b/.test(className);
  const hasWrapperShape = /\brounded-xl\b/.test(className);
  const hasFrame = /\b(border|shadow|ring)\b/.test(className);

  return hasSpacing && hasWrapperShape && !hasFrame ? node : null;
}

function SheetBodyContent({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const wrapper = getSheetBodyWrapperElement(children);

  if (wrapper) {
    return cloneElement(wrapper, { className });
  }

  return <div className={className}>{children}</div>;
}

function SheetFooterError({ error }: { error?: ReactNode }) {
  return error ? (
    <div
      role="alert"
      className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-800"
    >
      {error}
    </div>
  ) : null;
}

function SheetFooterHint({ hint }: { hint?: ReactNode }) {
  return hint ? (
    <div
      role="status"
      className="border-t border-border px-4 pt-2 text-xs text-muted-foreground"
    >
      {hint}
    </div>
  ) : null;
}

/**
 * A sheet that saves only changes (`requireChanges`) disables Save while the
 * form is unchanged. Say so next to the button instead of a silent, dead
 * Save (QA 2026-10-11, catalogue item sheet).
 */
function useNoChangesHint(enabled: boolean) {
  const { t } = useLang();
  const saveDisabled = useOverlaySaveDisabled();
  return enabled && saveDisabled ? t.common_save_no_changes : null;
}

function normalizeMetricValue(value: ReactNode) {
  return typeof value === "number" && !Number.isFinite(value) ? "-" : value;
}

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

/**
 * Grid of `AdminInlineMetric` cards: one column on the narrowest phones, two
 * from 360 px, all in one row from `xl`. A fixed column count squeezed four
 * cards into 82 px columns at 375 px and their texts overlapped (QA E-32).
 */
export const ADMIN_INLINE_METRICS_GRID =
  "grid grid-cols-1 gap-y-3 overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 min-[360px]:grid-cols-2 xl:grid-flow-col xl:grid-cols-none xl:auto-cols-fr [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block";

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
  const displayValue = normalizeMetricValue(value);

  return (
    <article
      className={cn(
        "relative min-w-[130px] flex-1 px-2.5 py-0.5",
        hasTwoLabels ? "min-h-[52px]" : "min-h-[36px]",
      )}
    >
      <div className="flex items-baseline gap-1.5">
        <Icon className="size-4 shrink-0 text-muted-foreground/55" />
        <p className="font-mono text-lg font-semibold leading-none tabular-nums text-foreground">
          {displayValue}
        </p>
      </div>
      {hasTwoLabels ? (
        <>
          <p className="mt-[4px] break-words text-[11px] leading-tight text-muted-foreground/75">
            {description}
          </p>
          <p className="mt-0.5 break-words text-xs font-medium leading-tight text-muted-foreground">
            {label}
          </p>
        </>
      ) : singleLabel ? (
        <p className="mt-0.5 break-words text-xs font-medium leading-tight text-muted-foreground">
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
  title?: ReactNode;
  description?: ReactNode;
  count?: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHeader = title !== undefined || count !== undefined || Boolean(accessory);
  return (
    <div className={cn("space-y-2", className)}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3 px-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {title !== undefined ? (
              <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                {title}
              </h3>
            ) : null}
            {count !== undefined ? <CountBadge>{count}</CountBadge> : null}
          </div>
          {accessory ? <div className="shrink-0">{accessory}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function AdminSectionTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "inline-flex min-w-0 items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]"
      />
      <span className="min-w-0 max-w-full break-words">{children}</span>
    </h3>
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
  bodyWrapperClassName,
  hideHeader = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  bodyWrapperClassName?: string;
  hideHeader?: boolean;
}) {
  void description;
  const resolvedBodyWrapperClassName = resolveSheetBodyWrapperClassName({
    bodyWrapperClassName,
  });

  return (
    <div className={cn("flex flex-1 min-h-0 flex-col", className)}>
      {hideHeader ? null : (
        <SheetHeader className={cn("shrink-0 px-4 pt-3 pb-1", headerClassName, "pr-14")}>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
      )}
      <div
        className={cn(
          "flex-1 overflow-y-auto space-y-4 px-5 py-4",
          bodyClassName,
        )}
      >
        <SheetBodyContent className={resolvedBodyWrapperClassName}>
          {children}
        </SheetBodyContent>
      </div>
      {footer}
    </div>
  );
}

export function SheetFormFooter({
  cancelLabel,
  error,
  submitLabel,
  submittingLabel,
  submitting = false,
  submitDisabled = false,
  hint,
  onCancel,
  onSubmit,
}: {
  cancelLabel: ReactNode;
  error?: ReactNode;
  submitLabel: ReactNode;
  submittingLabel?: ReactNode;
  submitting?: boolean;
  submitDisabled?: boolean;
  /** Neutral explanation shown next to the actions, e.g. why Save is disabled. */
  hint?: ReactNode;
  onCancel: () => void;
  onSubmit?: () => void;
}) {
  const handleCancel = useSheetDismissalGuard(onCancel);
  const saveDisabled = useOverlaySaveDisabled();
  const noChangesHint = useNoChangesHint(!submitting);

  return (
    <div className="shrink-0 bg-popover">
      <SheetFooterError error={error} />
      {error ? null : <SheetFooterHint hint={hint ?? noChangesHint} />}
      <div className="flex justify-end gap-2 px-4 py-3">
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-lg"
          onClick={handleCancel}
          disabled={submitting}
        >
          {cancelLabel}
        </Button>
        <Button
          type={onSubmit ? "button" : "submit"}
          className="h-9 rounded-lg"
          disabled={submitting || submitDisabled || saveDisabled}
          onClick={onSubmit}
        >
          {submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}
          {submitting ? (submittingLabel ?? submitLabel) : submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function SheetActionsFooter({
  children,
  error,
  hint,
  noChangesHint = false,
}: {
  children: ReactNode;
  error?: ReactNode;
  /** Neutral explanation shown above the actions. */
  hint?: ReactNode;
  /**
   * The footer holds the sheet's Save: say "no changes" while a
   * `requireChanges` sheet is unchanged. Off by default because some footers
   * only close a read-only sheet.
   */
  noChangesHint?: boolean;
}) {
  const noChangesText = useNoChangesHint(noChangesHint);

  return (
    <div className="shrink-0 bg-popover">
      <SheetFooterError error={error} />
      {error ? null : <SheetFooterHint hint={hint ?? noChangesText} />}
      <div className="flex justify-end gap-2 px-4 py-3">{children}</div>
    </div>
  );
}
