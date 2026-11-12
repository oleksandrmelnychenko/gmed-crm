import type { PortalConciergeServiceItem } from "./portal-shared";

type ContextItem = Pick<
  PortalConciergeServiceItem,
  "title" | "provider_name" | "assigned_concierge_name" | "appointment_title"
> & { vendor_name?: string | null };

/**
 * A linked appointment often has the service's title; show only extra context.
 *
 * The patient sees the supplier under its patient-facing name: the service's
 * vendor name, kept when a partner is booked (concierge QA fix 35 D-5); the
 * partner's own name only when no vendor name was given (release QA
 * 2026-11-13, A3). `vendorShownSeparately` leaves the vendor out when the card
 * already has its own «Поставщик» row.
 */
export function portalServiceContext(
  item: ContextItem,
  { vendorShownSeparately = false }: { vendorShownSeparately?: boolean } = {},
): string {
  const vendor = item.vendor_name?.trim() ?? "";
  const supplier = vendor ? (vendorShownSeparately ? "" : vendor) : item.provider_name;
  const seen = new Set([item.title.trim().toLocaleLowerCase()]);
  return [supplier, item.assigned_concierge_name, item.appointment_title]
    .map((value) => value?.trim() ?? "")
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" / ");
}
