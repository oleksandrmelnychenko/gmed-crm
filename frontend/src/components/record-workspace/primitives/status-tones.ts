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
