import { type ReactNode } from "react";
import { AlertCircle, Pencil, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ====================================================================
// DESIGN TOKENS
// Single source of truth for radii / surfaces / typography / sizing.
// Compose with cn() when reusing inside custom elements.
// ====================================================================

export const tokens = {
  radius: {
    sm: "rounded-lg",
    md: "rounded-xl",
    pill: "rounded-full",
  },
  surface: {
    card: "border border-border/50 bg-card",
    mutedCard: "border border-border/50 bg-muted/25",
    softCard: "border border-border/50 bg-card/40",
    dashed: "border border-dashed border-border/60 bg-muted/25",
  },
  text: {
    eyebrow: "text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80",
    label: "text-[11.5px] font-medium text-muted-foreground leading-tight",
    sectionTitle: "text-[13px] font-semibold tracking-tight text-foreground",
    body: "text-sm text-foreground",
    muted: "text-xs text-muted-foreground",
  },
  control: {
    inputHeight: "h-9",
    accessoryButton: "h-8 rounded-lg",
    primaryButton: "h-9 rounded-lg",
    iconButton: "size-3.5",
  },
} as const;

export const inputClass = cn(tokens.control.inputHeight, "rounded-lg bg-card");
export const selectClass =
  "h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";
export const textareaClass =
  "min-h-[80px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

// ====================================================================
// STATUS TONES
// Map any business status → one of 6 visual tones.
// Extend STATUS_TONE_MAP when new statuses appear.
// ====================================================================

export const STATUS_TONE = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  error: "border-rose-200 bg-rose-50 text-rose-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
  neutral: "border-border/60 bg-muted/25 text-muted-foreground",
  brand: "border-violet-200 bg-violet-50 text-violet-700",
} as const;

export type StatusTone = keyof typeof STATUS_TONE;

const STATUS_TONE_MAP: Record<string, StatusTone> = {
  active: "success",
  completed: "success",
  paid: "success",
  signed: "success",
  closed: "success",
  approved: "success",
  ready: "success",
  in_progress: "warning",
  partially_paid: "warning",
  pending: "warning",
  sent: "info",
  planned: "info",
  confirmed: "info",
  open: "info",
  draft: "neutral",
  expired: "neutral",
  archived: "neutral",
  cancelled: "error",
  terminated: "error",
  overdue: "error",
  rejected: "error",
  revoked: "error",
};

export function toneForStatus(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return STATUS_TONE_MAP[status] ?? "neutral";
}

// ====================================================================
// LAYOUT
// ====================================================================

export function TabShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4 mt-4 min-h-[400px]", className)}>{children}</div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

// ====================================================================
// SECTION
// Keeps the brand-dot + title + accessory pattern used across the app.
// ====================================================================

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
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-2 w-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className={cn(tokens.text.sectionTitle, "truncate")}>{title}</h3>
        </div>
        {accessory ? <div className="shrink-0">{accessory}</div> : null}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

// ====================================================================
// LIST ITEM
// Standard interactive or static card used in every list view.
// Pass onClick OR interactive prop to get hover affordance.
// ====================================================================

export function ListItem({
  onClick,
  interactive,
  className,
  children,
}: {
  onClick?: () => void;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const isButton = Boolean(onClick);
  const cls = cn(
    "rounded-xl px-4 py-3",
    tokens.surface.card,
    (interactive || isButton) &&
      "transition-colors hover:border-border hover:bg-muted/30 cursor-pointer",
    isButton && "w-full text-left",
    className,
  );
  if (isButton) {
    return (
      <button type="button" onClick={onClick} className={cls}>
        {children}
      </button>
    );
  }
  return <div className={cls}>{children}</div>;
}

// ====================================================================
// STAT CARD
// eyebrow + big number + caption. Use for workflow/timeline summaries.
// ====================================================================

export function StatCard({
  label,
  value,
  description,
}: {
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className={cn("rounded-xl px-4 py-3", tokens.surface.card)}>
      <p className={tokens.text.eyebrow}>{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      {description ? (
        <p className={cn("mt-1", tokens.text.muted)}>{description}</p>
      ) : null}
    </div>
  );
}

// ====================================================================
// STATUS BADGE
// Outlined pill coloured by business status OR explicit tone.
// ====================================================================

export function StatusBadge({
  status,
  tone,
  children,
  className,
}: {
  status?: string;
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  const resolved = tone ?? toneForStatus(status);
  return (
    <Badge
      variant="outline"
      className={cn("rounded-full text-[10px]", STATUS_TONE[resolved], className)}
    >
      {children}
    </Badge>
  );
}

export function Banner({
  tone,
  children,
  withIcon = false,
}: {
  tone: "error" | "warning";
  children: ReactNode;
  withIcon?: boolean;
}) {
  const classes =
    tone === "error"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        withIcon && "flex items-start gap-3",
        classes,
      )}
    >
      {withIcon ? (
        tone === "error" ? (
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
        ) : (
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        )
      ) : null}
      <div>{children}</div>
    </div>
  );
}

// ====================================================================
// INFO ROW
// Label above value, optional pencil on hover.
// ====================================================================

export function InfoRow({
  label,
  value,
  onEdit,
  editLabel,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  onEdit?: () => void;
  editLabel?: string;
  className?: string;
}) {
  const resolvedEditLabel =
    editLabel ??
    (typeof label === "string" ? `Edit ${label}` : "Edit");

  return (
    <div className={cn("group relative flex flex-col gap-1", className)}>
      <span className={tokens.text.label}>{label}</span>
      <span className={tokens.text.body}>{value}</span>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={resolvedEditLabel}
          className="absolute top-0 right-0 rounded-md p-1 text-muted-foreground/70 opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition"
        >
          <Pencil className={tokens.control.iconButton} />
        </button>
      ) : null}
    </div>
  );
}

// ====================================================================
// EMPTY / LOADING / COUNT
// ====================================================================

export function EmptyCell({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-8 text-sm text-muted-foreground text-center",
        tokens.surface.dashed,
      )}
    >
      {children}
    </div>
  );
}

export function CountBadge({ children }: { children: ReactNode }) {
  return (
    <Badge variant="outline" className={cn("rounded-full border-border/60 bg-muted/25 text-foreground")}>
      {children}
    </Badge>
  );
}

export function TabLoader() {
  return (
    <div className="flex items-center justify-center py-16">
      <span className="size-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground/70" />
    </div>
  );
}

// ====================================================================
// FIELD
// Simple label + input wrapper.
// ====================================================================

export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className={cn(tokens.text.label, "block")}>
        {label}
      </label>
      {children}
    </div>
  );
}
