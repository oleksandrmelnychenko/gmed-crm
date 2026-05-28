import type { ProviderTaxonomyNode, ProviderType } from "./types";

export type ProviderTaxonomySelectionMode = "any" | "leaf";

export type ProviderTaxonomyScope = ProviderType | "" | null | undefined;

const TAXONOMY_LEVEL_ORDER: ProviderTaxonomyNode["level"][] = [
  "category",
  "group",
  "subgroup",
  "type",
];

export function providerTaxonomyNodeLabel(
  node: Pick<ProviderTaxonomyNode, "code" | "name_de" | "name_en" | "name_ru">,
  lang: "de" | "ru",
) {
  if (lang === "ru") {
    return node.name_ru || node.name_de || node.name_en || node.code;
  }
  return node.name_de || node.name_en || node.name_ru || node.code;
}

export function providerTaxonomyMatchesScope(
  node: ProviderTaxonomyNode,
  providerType: ProviderTaxonomyScope,
) {
  if (providerType === "medical" || providerType === "non_medical") {
    return node.provider_kind === providerType;
  }
  return true;
}

export function providerTaxonomyKindRoot(
  nodes: ProviderTaxonomyNode[],
  providerType: ProviderTaxonomyScope,
) {
  if (providerType !== "medical" && providerType !== "non_medical") return null;

  return (
    nodes.find(
      (node) =>
        node.is_active &&
        node.parent_id === null &&
        node.level === "category" &&
        node.provider_kind === providerType,
    ) ?? null
  );
}

export function providerTaxonomyPathForNodeId(
  nodes: ProviderTaxonomyNode[],
  nodeId: string,
) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const path: ProviderTaxonomyNode[] = [];
  const visited = new Set<string>();
  let current = nodesById.get(nodeId);

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parent_id ? nodesById.get(current.parent_id) : undefined;
  }

  return path;
}

export function providerTaxonomyVisiblePathForNodeId(
  nodes: ProviderTaxonomyNode[],
  nodeId: string,
  providerType: ProviderTaxonomyScope,
) {
  const path = providerTaxonomyPathForNodeId(nodes, nodeId);
  const root = providerTaxonomyKindRoot(nodes, providerType);
  if (root && path[0]?.id === root.id) {
    return path.slice(1);
  }
  return path;
}

export function providerTaxonomyChildren(
  nodes: ProviderTaxonomyNode[],
  parentId: string | null,
  providerType: ProviderTaxonomyScope,
) {
  const localeAwareLevel = (node: ProviderTaxonomyNode) =>
    TAXONOMY_LEVEL_ORDER.indexOf(node.level);

  return nodes
    .filter(
      (node) =>
        node.is_active &&
        node.parent_id === parentId &&
        providerTaxonomyMatchesScope(node, providerType),
    )
    .toSorted(
      (left, right) =>
        localeAwareLevel(left) - localeAwareLevel(right) ||
        left.sort_order - right.sort_order ||
        left.code.localeCompare(right.code),
    );
}

export function providerTaxonomyHasChildren(
  nodes: ProviderTaxonomyNode[],
  nodeId: string,
) {
  return nodes.some((node) => node.is_active && node.parent_id === nodeId);
}

export function providerTaxonomyIsLeafSelection(
  node: ProviderTaxonomyNode | null | undefined,
) {
  return Boolean(node && node.level === "type" && node.is_active);
}

export function providerTaxonomyCanCommitSelection(
  node: ProviderTaxonomyNode | null | undefined,
  mode: ProviderTaxonomySelectionMode,
) {
  if (!node) return false;
  if (mode === "any") return node.is_active;
  return providerTaxonomyIsLeafSelection(node);
}
