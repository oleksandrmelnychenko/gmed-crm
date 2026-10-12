import {
  agencyServiceLineName,
  agencyServiceNameLabel,
  agencyServiceUnitCount,
} from "@/lib/agency-service-labels";
import type { Lang, Translations } from "@/lib/i18n";

import type { OrderDetail } from "./types";

type ScopedLine = OrderDetail["leistungen"][number];

/**
 * The service name of a line in the read-only order part. The line keeps the
 * catalogue's own (German) name or what the patient manager wrote; a known
 * catalogue name shows in the UI language like on the staff screens
 * ("Flughafentransfer" → "Трансфер из аэропорта", QA C2-13), own text stays.
 */
export function scopedLineName(line: ScopedLine, translations: Translations): string {
  const description = line.description?.trim();
  if (description) {
    return agencyServiceLineName(line.agency_service_key, description, translations) || description;
  }
  return agencyServiceNameLabel(line.agency_service_key, line.agency_service_name, translations);
}

/** "2 поездки", "1,5 часа" (QA C2-04: "2 поездка"). */
export function scopedLineQuantity(line: ScopedLine, translations: Translations, lang: Lang): string {
  const quantity = line.quantity;
  const value =
    typeof quantity === "number" || typeof quantity === "string" ? String(quantity) : "";
  return agencyServiceUnitCount(value, line.agency_service_unit_label, translations, lang);
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
