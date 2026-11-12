import { hasCapability, type Actor } from "@/lib/permissions";

export type ServicesPermissions = {
  canViewPage: boolean;
  canCreateService: boolean;
  canEditService: boolean;
  /** Provider link, title and price: the registry owners, not the concierge desk. */
  canEditProtectedServiceFields: boolean;
  /** The internal cost estimate of an existing service: every editor, the
   * concierge included (owner decision 2026-11-12). */
  canEditServiceCostEstimate: boolean;
};

export function servicesPermissions(actor?: Actor): ServicesPermissions {
  const canEdit = hasCapability(actor, "services.edit");
  return {
    canViewPage: hasCapability(actor, "services.view"),
    canCreateService: canEdit,
    canEditService: canEdit,
    canEditProtectedServiceFields: canEdit && hasCapability(actor, "providers.registry"),
    canEditServiceCostEstimate: canEdit,
  };
}

/**
 * The estimate field after a catalogue item or the quantity changed: the new
 * catalogue total replaces only an empty field or the value the catalogue
 * filled in before; an estimate the user typed stays (concierge QA D-4).
 */
export function autoFilledCostEstimate(
  current: string,
  previousAuto: string,
  nextAuto: string,
): string {
  const untouched = !current.trim() || current === previousAuto;
  return untouched ? nextAuto : current;
}
