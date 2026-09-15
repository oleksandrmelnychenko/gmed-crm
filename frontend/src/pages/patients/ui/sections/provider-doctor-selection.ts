import type { AllDoctorOption } from "@/pages/patients/data/patient-clinical";
import type { ProviderSummary } from "@/pages/providers/model/types";

type ProviderHierarchyNode = Pick<
  ProviderSummary,
  "id" | "name" | "parent_provider_id"
>;

export type ScopedDoctorOption = AllDoctorOption & {
  selected_provider_id: string;
  selected_provider_name: string;
};

function doctorProviderLinks(doctor: AllDoctorOption) {
  if (doctor.provider_links?.length) return doctor.provider_links;
  if (!doctor.provider_id) return [];
  return [{ id: doctor.provider_id, name: doctor.provider_name ?? "" }];
}

/** Returns the selected provider and every descendant, with depth from the selection. */
export function providerBranchDepths(
  providers: readonly ProviderHierarchyNode[],
  selectedProviderId: string | null,
): Map<string, number> {
  const depths = new Map<string, number>();
  if (!selectedProviderId) return depths;

  depths.set(selectedProviderId, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const provider of providers) {
      if (depths.has(provider.id) || !provider.parent_provider_id) continue;
      const parentDepth = depths.get(provider.parent_provider_id);
      if (parentDepth === undefined) continue;
      depths.set(provider.id, parentDepth + 1);
      changed = true;
    }
  }
  return depths;
}

/**
 * Filters doctors to the selected provider branch. If a doctor is linked at
 * several levels, the deepest matching provider is used for attribution.
 */
export function doctorsForProviderBranch(
  providers: readonly ProviderHierarchyNode[],
  doctors: readonly AllDoctorOption[],
  selectedProviderId: string | null,
): ScopedDoctorOption[] {
  const depths = providerBranchDepths(providers, selectedProviderId);
  if (depths.size === 0) return [];

  const providerNames = new Map(providers.map((provider) => [provider.id, provider.name]));
  return doctors.flatMap((doctor) => {
    const matchingLinks = doctorProviderLinks(doctor)
      .filter((link) => depths.has(link.id))
      .sort((left, right) => {
        const depthDifference = (depths.get(right.id) ?? 0) - (depths.get(left.id) ?? 0);
        if (depthDifference !== 0) return depthDifference;
        return left.name.localeCompare(right.name);
      });
    const provider = matchingLinks[0];
    if (!provider) return [];
    return [{
      ...doctor,
      selected_provider_id: provider.id,
      selected_provider_name: providerNames.get(provider.id) ?? provider.name,
    }];
  });
}
