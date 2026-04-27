import type { StatusTone } from "@/components/ui-shell";

export function statusBadgeClass(status: string): StatusTone {
  switch (status) {
    case "paid":
      return "success";
    case "partially_paid":
      return "warning";
    case "sent":
      return "info";
    case "overdue":
    case "cancelled":
      return "error";
    default:
      return "neutral";
  }
}

export function invoiceTypeTone(invoiceType: string): StatusTone {
  switch (invoiceType) {
    case "advance":
      return "warning";
    case "interim":
      return "info";
    case "final":
      return "success";
    default:
      return "neutral";
  }
}

export function dunningLevelTone(level: string): StatusTone {
  switch (level) {
    case "first":
      return "warning";
    case "second":
    case "collections":
      return "error";
    default:
      return "neutral";
  }
}
