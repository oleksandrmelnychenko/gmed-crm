import type { StatusTone } from "@/components/ui-shell";

export function orderPhaseTone(phase: string): StatusTone {
  switch (phase) {
    case "intake":
      return "info";
    case "execution":
      return "warning";
    case "closure":
      return "success";
    case "followup":
      return "brand";
    default:
      return "neutral";
  }
}

export function orderStatusTone(status: string): StatusTone {
  switch (status) {
    case "active":
    case "completed":
      return "success";
    case "paused":
      return "warning";
    case "cancelled":
      return "error";
    default:
      return "neutral";
  }
}

export function priorityBadgeClass(priority: string) {
  switch (priority) {
    case "urgent":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "high":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "low":
      return "border-slate-200 bg-slate-50 text-slate-600";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

export function recheckBadgeClass(passed: boolean) {
  return passed
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
}

export function statusClassName(status: string) {
  switch (status) {
    case "active":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    case "paused":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "review_required":
    case "awaiting_payment":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "payment_plan":
      return "border-sky-200 bg-sky-100 text-sky-700";
    case "escalated":
      return "border-rose-200 bg-rose-100 text-rose-700";
    case "cleared":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    case "not_required":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "completed":
      return "border-sky-200 bg-sky-100 text-sky-700";
    case "cancelled":
      return "border-rose-200 bg-rose-100 text-rose-700";
    case "draft":
      return "border-slate-200 bg-slate-100 text-slate-700";
    case "delivered":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "approved":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    case "received":
      return "border-sky-200 bg-sky-100 text-sky-700";
    case "overdue":
      return "border-rose-200 bg-rose-100 text-rose-700";
    case "paid":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    case "expected":
      return "border-violet-200 bg-violet-100 text-violet-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}
