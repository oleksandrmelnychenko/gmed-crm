import type { ProviderTaxonomyNode, ProviderType } from "@/pages/providers/model/types";

type InsuranceCoverageItem = { id?: string | null; name?: string | null };

/** Minimal shape needed to match a provider against a type + taxonomy category. */
export type ProviderTaxonomyCarrier = {
  id: string;
  name: string;
  provider_type?: string | null;
  address_city?: string | null;
  taxonomy_node_id?: string | null;
  taxonomy_node_ids?: string[];
  /** Assigned nodes + all their ancestors; used for parent-category filtering. */
  taxonomy_filter_ids?: string[];
  taxonomy_node?: { id?: string | null } | null;
  taxonomy_path?: Array<{ id?: string | null }>;
  /** Insurances this provider accepts (medical providers only). */
  insurance_providers?: InsuranceCoverageItem[];
  /** Insurances accepted by doctors linked to this provider relationship. */
  doctor_insurance_providers?: InsuranceCoverageItem[];
  doctors?: Array<{ insurance_providers?: InsuranceCoverageItem[] } | null>;
};

function providerInsuranceCoverageItems(provider: ProviderTaxonomyCarrier) {
  return [
    ...(provider.insurance_providers ?? []),
    ...(provider.doctor_insurance_providers ?? []),
    ...(provider.doctors ?? []).flatMap((doctor) => doctor?.insurance_providers ?? []),
  ];
}

/** Deduped {id,name} list of every insurance accepted by the given providers. */
export function collectInsuranceOptions<TProvider extends ProviderTaxonomyCarrier>(
  providers: readonly TProvider[],
): Array<{ id: string; name: string }> {
  const byId = new Map<string, string>();
  for (const provider of providers) {
    for (const item of providerInsuranceCoverageItems(provider)) {
      const id = (item?.id ?? "").trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, (item?.name ?? "").trim() || id);
    }
  }
  return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

export function providerMatchesInsurance(
  provider: ProviderTaxonomyCarrier,
  insuranceId: string,
): boolean {
  const selected = insuranceId.trim();
  if (!selected) return true;
  return providerInsuranceCoverageItems(provider).some(
    (item) => (item?.id ?? "").trim() === selected,
  );
}

/** Every taxonomy node id a provider belongs to (assigned node + ancestors + path). */
export function providerTaxonomyIdList(provider: ProviderTaxonomyCarrier): string[] {
  return [
    provider.taxonomy_node_id ?? "",
    provider.taxonomy_node?.id ?? "",
    ...(provider.taxonomy_filter_ids ?? []),
    ...(provider.taxonomy_node_ids ?? []),
    ...(provider.taxonomy_path ?? []).map((node) => node.id ?? ""),
  ].filter(Boolean);
}

export function providerMatchesType(
  provider: ProviderTaxonomyCarrier,
  providerType: ProviderType | "" | null | undefined,
): boolean {
  if (providerType !== "medical" && providerType !== "non_medical") return true;
  return provider.provider_type === providerType;
}

export function providerMatchesTaxonomy(
  provider: ProviderTaxonomyCarrier,
  taxonomyNodeId: string,
): boolean {
  const selected = taxonomyNodeId.trim();
  if (!selected) return true;
  return new Set(providerTaxonomyIdList(provider)).has(selected);
}

/**
 * Returns only the taxonomy categories that contain at least one provider of the given type
 * — plus the ancestor chain of each (so the cascade tree stays connected to its root) and
 * the ancestor chain of the current selection (so a chosen category never disappears).
 *
 * Returns all nodes unchanged while there are no providers yet (loading), so the picker is
 * not emptied prematurely.
 */
export function selectAvailableTaxonomyNodes<TProvider extends ProviderTaxonomyCarrier>(
  taxonomyNodes: ProviderTaxonomyNode[],
  providers: readonly TProvider[],
  providerType: ProviderType | "" | null | undefined,
  selectedTaxonomyValue: string,
): ProviderTaxonomyNode[] {
  if (providers.length === 0) return taxonomyNodes;

  const byId = new Map(taxonomyNodes.map((node) => [node.id, node]));
  const allowed = new Set<string>();
  const addWithAncestors = (startId: string) => {
    let cursor: string | null = startId;
    while (cursor && !allowed.has(cursor)) {
      allowed.add(cursor);
      cursor = byId.get(cursor)?.parent_id ?? null;
    }
  };

  for (const provider of providers) {
    if (!providerMatchesType(provider, providerType)) continue;
    for (const id of providerTaxonomyIdList(provider)) addWithAncestors(id);
  }

  const selected = selectedTaxonomyValue.trim();
  if (selected) addWithAncestors(selected);

  return taxonomyNodes.filter((node) => allowed.has(node.id));
}
