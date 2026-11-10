import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { formatPortalTimestamp } from "@/lib/portal-datetime";

export function PortalDateChip({ children, timestamp, icon: Icon = CalendarDays, title }: { children?: ReactNode; timestamp?: string | null; icon?: typeof CalendarDays; title?: string }) {
  const content = timestamp ? <time dateTime={timestamp}>{formatPortalTimestamp(timestamp)}</time> : children;
  if (!content || content === "—" || content === "–") return <span>{content || "—"}</span>;
  return <StatusChip tone="neutral" title={title} className="portal-date-chip"><Icon aria-hidden="true" /><span className="min-w-0 whitespace-normal">{content}</span></StatusChip>;
}
