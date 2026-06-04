import type { ProviderTaxonomyNode, ProviderType } from "@/pages/providers/model/types";

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
};

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
