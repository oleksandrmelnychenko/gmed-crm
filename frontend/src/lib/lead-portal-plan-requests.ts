import { apiFetch } from "@/lib/api";

export type LeadPortalPlanKind = "gmed_one" | "gmed_reserve" | "treatment";

export interface LeadPortalPlanPackage {
  id: string;
  package_key: string;
  name: string;
  description: string | null;
  kind: LeadPortalPlanKind;
}

export interface LeadPortalPlanRequest {
  id: string;
  package_id: string;
  subscription_kind: LeadPortalPlanKind;
  module_id: string;
  requested_at: string;
  status: "pending" | "closed";
}

export interface LeadPortalPlanCatalogue {
  packages: LeadPortalPlanPackage[];
  requests: LeadPortalPlanRequest[];
}

function endpoint(leadId: string): string {
  return `/me/lead-requests/${encodeURIComponent(leadId)}/plan-requests`;
}

export function fetchLeadPortalPlanCatalogue(leadId: string): Promise<LeadPortalPlanCatalogue> {
  return apiFetch<LeadPortalPlanCatalogue>(endpoint(leadId), { forceFresh: true });
}

/** Records interest only. The API never activates a package or unlocks a module. */
export function requestLeadPortalPlan(
  leadId: string,
  packageId: string,
  moduleId: string,
): Promise<{ request: LeadPortalPlanRequest; created: boolean }> {
  return apiFetch(endpoint(leadId), {
    method: "POST",
    body: JSON.stringify({ package_id: packageId, module_id: moduleId }),
  });
}
