import type { StatusTone } from "@/components/ui-shell";

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
      return "info";
    case "archived":
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
      return "bg-indigo-500";
    case "archived":
      return "bg-slate-300";
    default:
      return "bg-slate-300";
  }
}
