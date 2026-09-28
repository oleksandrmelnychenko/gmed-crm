import { agencyServiceNameLabel, agencyServiceUnitLabel } from "@/lib/agency-service-labels";
import type { Translations } from "@/lib/i18n";

import type { OrderDetail } from "./types";

type ScopedLine = OrderDetail["leistungen"][number];

/**
 * The service name of a line in the read-only order part. The line's own
 * description is what the patient manager chose or wrote (in the UI
 * language); the catalog name is stored in English and only translated for
 * the known catalog entries.
 */
export function scopedLineName(line: ScopedLine, translations: Translations): string {
  const description = line.description?.trim();
  if (description) return description;
  return agencyServiceNameLabel(line.agency_service_key, line.agency_service_name, translations);
}

export function scopedLineQuantity(line: ScopedLine, translations: Translations): string {
  const quantity = line.quantity;
  const value =
    typeof quantity === "number" || typeof quantity === "string" ? String(quantity) : "";
  const unit = line.agency_service_unit_label;
  return unit ? `${value} ${agencyServiceUnitLabel(unit, translations)}` : value;
}

/**
 * Whether the viewer may record this line of their order part as delivered.
 * Only the concierge part: the server lists there just the concierge's
 * service and logistics lines (partner lines and the agency's own lines
 * without a partner) and refuses medical lines. A line is delivered once.
 */
export function canDeliverScopedLine(
  detail: Pick<OrderDetail, "read_scope">,
  line: Pick<ScopedLine, "delivered_at" | "status">,
  viewerRole: string | null | undefined,
): boolean {
  return (
    viewerRole === "concierge" &&
    detail.read_scope === "concierge_services" &&
    !line.delivered_at &&
    line.status !== "cancelled"
  );
}
