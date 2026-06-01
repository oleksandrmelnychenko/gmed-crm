import type { AppointmentKind } from "@/pages/appointments/model/types";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";

type UiLanguage = "de" | "ru";

type ProviderTaxonomyOption = {
  id: string;
  label: string;
  providerKind: string;
};

type ProviderTaxonomyPathItem = {
  id: string;
  code?: string | null;
  level?: string | null;
  name_de?: string | null;
  name_en?: string | null;
  name_ru?: string | null;
};

type ProviderTaxonomyCarrier = {
  id: string;
  name: string;
  provider_type: string;
  address_city?: string | null;
  taxonomy_node_id?: string | null;
  taxonomy_node_code?: string | null;
  taxonomy_node_name_de?: string | null;
  taxonomy_node_name_ru?: string | null;
  taxonomy_node?: ProviderTaxonomyPathItem | null;
  taxonomy_path?: ProviderTaxonomyPathItem[];
  taxonomy_node_ids?: string[];
  /** Assigned nodes + all their ancestors; used for parent-category filtering. */
  taxonomy_filter_ids?: string[];
};

function taxonomyNodeLabel(
  node: {
    code?: string | null;
    name_de?: string | null;
    name_en?: string | null;
    name_ru?: string | null;
  },
  lang: UiLanguage,
) {
  if (lang === "ru") {
    return node.name_ru || node.name_de || node.name_en || node.code || "";
  }
  return node.name_de || node.name_en || node.name_ru || node.code || "";
}

function providerPrimaryTaxonomyLabel(provider: ProviderTaxonomyCarrier, lang: UiLanguage) {
  const nodeLabel = provider.taxonomy_node
    ? taxonomyNodeLabel(provider.taxonomy_node, lang)
    : "";
  if (nodeLabel) return nodeLabel;

  return taxonomyNodeLabel(
    {
      code: provider.taxonomy_node_code,
      name_de: provider.taxonomy_node_name_de,
      name_ru: provider.taxonomy_node_name_ru,
    },
    lang,
  );
}

function isProviderKindRoot(node: ProviderTaxonomyPathItem) {
  return (
    node.level === "category" ||
    node.code === "medical_providers" ||
    node.code === "nonmedical_providers"
  );
}

function providerTaxonomyPathLabel(provider: ProviderTaxonomyCarrier, lang: UiLanguage) {
  const path = provider.taxonomy_path ?? [];
  if (!path.length) return "";
  const root = path[0];
  const visiblePath = root && path.length > 1 && isProviderKindRoot(root) ? path.slice(1) : path;

  return visiblePath
    .map((item) => taxonomyNodeLabel(item, lang))
    .filter(Boolean)
    .join(" / ");
}

function taxonomyPathLabelFromNodes(
  node: ProviderTaxonomyNode,
  nodesById: Map<string, ProviderTaxonomyNode>,
  lang: UiLanguage,
  omitProviderKindRoot: boolean,
) {
  const path: ProviderTaxonomyNode[] = [];
  let current: ProviderTaxonomyNode | undefined = node;
  while (current) {
    path.unshift(current);
    current = current.parent_id ? nodesById.get(current.parent_id) : undefined;
  }

  const visiblePath =
    omitProviderKindRoot && path.length > 1 && path[0]?.level === "category"
      ? path.slice(1)
      : path;

  return visiblePath
    .map((item) => taxonomyNodeLabel(item, lang))
    .filter(Boolean)
    .join(" / ");
}

function providerKindMatchesAppointmentType(
  providerKind: string,
  appointmentType: AppointmentKind | string | null | undefined,
) {
  if (appointmentType === "medical") return providerKind === "medical";
  if (appointmentType === "non_medical") return providerKind === "non_medical";
  return true;
}

function providerTaxonomyIds(provider: ProviderTaxonomyCarrier) {
  return new Set([
    ...(provider.taxonomy_filter_ids ?? []),
    ...(provider.taxonomy_node_ids ?? []),
    ...(provider.taxonomy_path ?? []).map((node) => node.id),
    provider.taxonomy_node?.id ?? "",
    provider.taxonomy_node_id ?? "",
  ].filter(Boolean));
}

export function providerMatchesAppointmentType(
  provider: ProviderTaxonomyCarrier,
  appointmentType: AppointmentKind | string | null | undefined,
) {
  if (appointmentType === "internal") return false;
  if (appointmentType === "medical") return provider.provider_type === "medical";
  if (appointmentType === "non_medical") return provider.provider_type === "non_medical";
  return true;
}

export function providerMatchesTaxonomyFilter(
  provider: ProviderTaxonomyCarrier,
  taxonomyNodeId: string,
) {
  const selected = taxonomyNodeId.trim();
  if (!selected) return true;
  return providerTaxonomyIds(provider).has(selected);
}

export function providerTaxonomyDisplayLabel(
  provider: ProviderTaxonomyCarrier,
  lang: UiLanguage,
) {
  return providerTaxonomyPathLabel(provider, lang) || providerPrimaryTaxonomyLabel(provider, lang);
}

export function providerOptionLabel(provider: ProviderTaxonomyCarrier, lang: UiLanguage) {
  const meta = [
    provider.address_city?.trim(),
    providerTaxonomyDisplayLabel(provider, lang),
  ].filter(Boolean);

  return meta.length ? `${provider.name} - ${meta.join(" - ")}` : provider.name;
}

export function filterProvidersForAppointmentScope<T extends ProviderTaxonomyCarrier>(
  providers: T[],
  appointmentType: AppointmentKind | string | null | undefined,
  taxonomyNodeId = "",
) {
  return providers.filter(
    (provider) =>
      providerMatchesAppointmentType(provider, appointmentType) &&
      providerMatchesTaxonomyFilter(provider, taxonomyNodeId),
  );
}

export function providerSelectionFitsAppointmentScope(
  providers: ProviderTaxonomyCarrier[],
  providerId: string,
  appointmentType: AppointmentKind | string | null | undefined,
  taxonomyNodeId = "",
) {
  if (!providerId) return true;
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) return false;
  return (
    providerMatchesAppointmentType(provider, appointmentType) &&
    providerMatchesTaxonomyFilter(provider, taxonomyNodeId)
  );
}

export function providerTaxonomyFilterOptions(
  providers: ProviderTaxonomyCarrier[],
  appointmentType: AppointmentKind | string | null | undefined,
  lang: UiLanguage,
): ProviderTaxonomyOption[] {
  const byId = new Map<string, ProviderTaxonomyOption>();

  for (const provider of providers) {
    if (!providerMatchesAppointmentType(provider, appointmentType)) continue;

    const path = provider.taxonomy_path ?? [];
    for (let index = 0; index < path.length; index += 1) {
      const node = path[index];
      const label = path
        .slice(0, index + 1)
        .map((item) => taxonomyNodeLabel(item, lang))
        .filter(Boolean)
        .join(" / ");
      if (!label) continue;
      byId.set(node.id, {
        id: node.id,
        label,
        providerKind: provider.provider_type,
      });
    }

    if (provider.taxonomy_node_id && !byId.has(provider.taxonomy_node_id)) {
      const label = providerPrimaryTaxonomyLabel(provider, lang);
      if (label) {
        byId.set(provider.taxonomy_node_id, {
          id: provider.taxonomy_node_id,
          label,
          providerKind: provider.provider_type,
        });
      }
    }
  }

  const locale = lang === "ru" ? "ru" : "de";
  return [...byId.values()].sort((left, right) => {
    const kindOrder = left.providerKind.localeCompare(right.providerKind);
    if (kindOrder) return kindOrder;
    return left.label.localeCompare(right.label, locale);
  });
}

export function providerTaxonomyTreeOptions(
  taxonomyNodes: ProviderTaxonomyNode[],
  appointmentType: AppointmentKind | string | null | undefined,
  lang: UiLanguage,
): ProviderTaxonomyOption[] {
  if (appointmentType === "internal") return [];

  const nodesById = new Map(taxonomyNodes.map((node) => [node.id, node]));
  const omitProviderKindRoot = appointmentType === "medical" || appointmentType === "non_medical";
  const locale = lang === "ru" ? "ru" : "de";

  return taxonomyNodes
    .filter(
      (node) =>
        node.is_active &&
        node.level !== "category" &&
        providerKindMatchesAppointmentType(node.provider_kind, appointmentType),
    )
    .map((node) => ({
      id: node.id,
      label:
        taxonomyPathLabelFromNodes(node, nodesById, lang, omitProviderKindRoot) ||
        taxonomyNodeLabel(node, lang),
      providerKind: node.provider_kind,
    }))
    .filter((option) => option.label)
    .sort((left, right) => {
      const kindOrder = left.providerKind.localeCompare(right.providerKind);
      if (kindOrder) return kindOrder;
      return left.label.localeCompare(right.label, locale);
    });
}
