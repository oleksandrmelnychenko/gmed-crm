import type { StatusTone } from "@/components/ui-shell";

/** Whole days elapsed since the lead entered its current status; null when unknown. */
export function daysInStatus(
  statusChangedAt?: string | null,
  now: Date = new Date(),
): number | null {
  if (!statusChangedAt) return null;
  const then = new Date(statusChangedAt);
  if (Number.isNaN(then.getTime())) return null;
  const ms = now.getTime() - then.getTime();
  return ms < 0 ? 0 : Math.floor(ms / 86_400_000);
}

/** Short bilingual "N дн"/"N T." label for the days-in-status chip. */
export function daysInStatusLabel(days: number, lang: string): string {
  return lang === "de" ? `${days} T.` : `${days} дн`;
}

export function leadStatusTone(status: string): StatusTone {
  switch (status) {
    case "new":
      return "info";
    case "in_progress":
      return "warning";
    case "qualified":
      return "success";
    case "not_qualified":
      return "error";
    case "converted":
      return "brand";
    case "archived":
    case "deleted":
      return "neutral";
    default:
      return "neutral";
  }
}

export function complianceTone(status?: string | null): StatusTone {
  switch (status) {
    case "signed":
      return "success";
    case "documents_sent":
      return "warning";
    case "rejected":
      return "error";
    case "pending":
      return "neutral";
    default:
      return "neutral";
  }
}

export function failedOutcomeTone(status?: string | null): StatusTone {
  if (!status || status === "none") return "neutral";
  if (status === "delete_anonymized") return "error";
  return "warning";
}

export function leadRowAccent(status: string): string {
  switch (status) {
    case "new":
      return "bg-sky-500";
    case "in_progress":
      return "bg-amber-500";
    case "qualified":
      return "bg-emerald-500";
    case "not_qualified":
      return "bg-rose-500";
    case "converted":
      return "bg-violet-500";
    case "archived":
    case "deleted":
      return "bg-slate-300";
    default:
      return "bg-slate-300";
  }
}
