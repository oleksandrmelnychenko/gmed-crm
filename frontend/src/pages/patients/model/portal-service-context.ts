import type { PortalConciergeServiceItem } from "./portal-shared";

// A linked appointment often has the service's title; show only extra context.
export function portalServiceContext(item: Pick<PortalConciergeServiceItem, "title" | "provider_name" | "assigned_concierge_name" | "appointment_title">): string {
  const seen = new Set([item.title.trim().toLocaleLowerCase()]);
  return [item.provider_name, item.assigned_concierge_name, item.appointment_title]
    .map((value) => value?.trim() ?? "")
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" / ");
}
