import { hasCapability, type Actor } from "@/lib/permissions";

export type ServicesPermissions = {
  canViewPage: boolean;
  canCreateService: boolean;
  canEditService: boolean;
  /** Provider link, title and price: the registry owners, not the concierge desk. */
  canEditProtectedServiceFields: boolean;
};

export function servicesPermissions(actor?: Actor): ServicesPermissions {
  const canEdit = hasCapability(actor, "services.edit");
  return {
    canViewPage: hasCapability(actor, "services.view"),
    canCreateService: canEdit,
    canEditService: canEdit,
    canEditProtectedServiceFields: canEdit && hasCapability(actor, "providers.registry"),
  };
}
