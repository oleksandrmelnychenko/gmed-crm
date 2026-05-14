import { useMemo } from "react";

import { applyFilters } from "@/components/data-table/filter-logic";
import { buildSearchIndex, searchWithIndex } from "@/components/data-table/search";
import { applySort } from "@/components/data-table/sort-logic";
import type { ColumnDef, FilterPredicate, SortStack } from "@/components/data-table/types";

import { buildProviderColumns } from "../providers-columns";
import type { ProviderTreeMeta } from "../providers-columns";
import type { ProviderSummary } from "../../model/types";

type UseProvidersListTableModelArgs = {
  collapsedProviderIds?: ReadonlySet<string>;
  deferredSearch: string;
  filterPredicates?: readonly FilterPredicate[];
  frozenColumns?: readonly string[];
  onToggleProviderCollapsed?: (providerId: string) => void;
  providers: ProviderSummary[];
  sortStack: SortStack;
  tr: Record<string, string>;
};

type ProviderMetrics = {
  active: number;
  appointments: number;
  conciergeRequests: number;
  doctors: number;
  medical: number;
  nonMedical: number;
  openConciergeRequests: number;
  patients: number;
  services: number;
  total: number;
};

type ProviderTreeRowsResult = {
  rows: ProviderSummary[];
  treeMetaById: Map<string, ProviderTreeMeta>;
};

type BuildProviderTreeRowsArgs = {
  accessors: Record<string, ColumnDef<ProviderSummary>["accessor"]>;
  collapsedProviderIds: ReadonlySet<string>;
  hasActiveTableQuery: boolean;
  matchedProviders: readonly ProviderSummary[];
  providers: readonly ProviderSummary[];
  sortStack: SortStack;
};

const EMPTY_PROVIDER_ID_SET: ReadonlySet<string> = new Set();
const EMPTY_STRING_LIST: readonly string[] = [];
const EMPTY_FILTER_PREDICATES: readonly FilterPredicate[] = [];

export function buildProviderTreeRows({
  accessors,
  collapsedProviderIds,
  hasActiveTableQuery,
  matchedProviders,
  providers,
  sortStack,
}: BuildProviderTreeRowsArgs): ProviderTreeRowsResult {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const matchedIds = new Set(matchedProviders.map((provider) => provider.id));
  const includedIds = new Set<string>();
  const forcedExpandedIds = new Set<string>();

  if (hasActiveTableQuery) {
    for (const provider of matchedProviders) {
      includedIds.add(provider.id);

      const seen = new Set([provider.id]);
      let parentId = provider.parent_provider_id;

      while (parentId && !seen.has(parentId)) {
        const parent = providerById.get(parentId);
        if (!parent) break;

        includedIds.add(parent.id);
        forcedExpandedIds.add(parent.id);
        seen.add(parent.id);
        parentId = parent.parent_provider_id;
      }
    }
  } else {
    for (const provider of providers) {
      includedIds.add(provider.id);
    }
  }

  const includedProviders = providers.filter((provider) => includedIds.has(provider.id));
  const includedById = new Set(includedProviders.map((provider) => provider.id));
  const childrenByParentId = new Map<string | null, ProviderSummary[]>();

  for (const provider of includedProviders) {
    const parentId =
      provider.parent_provider_id && includedById.has(provider.parent_provider_id)
        ? provider.parent_provider_id
        : null;
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(provider);
    childrenByParentId.set(parentId, children);
  }

  const sortSiblings = (rows: ProviderSummary[]) => applySort(rows, sortStack, { accessors });
  const rows: ProviderSummary[] = [];
  const treeMetaById = new Map<string, ProviderTreeMeta>();
  const visitedIds = new Set<string>();

  const markDescendantsVisited = (providerId: string) => {
    const children = childrenByParentId.get(providerId) ?? [];
    for (const child of children) {
      if (visitedIds.has(child.id)) continue;
      visitedIds.add(child.id);
      markDescendantsVisited(child.id);
    }
  };

  const appendNode = (provider: ProviderSummary, depth: number) => {
    if (visitedIds.has(provider.id)) return;

    visitedIds.add(provider.id);

    const children = childrenByParentId.get(provider.id) ?? [];
    const hasChildren = children.length > 0;
    const isExpanded =
      hasChildren && (forcedExpandedIds.has(provider.id) || !collapsedProviderIds.has(provider.id));

    treeMetaById.set(provider.id, {
      childCount: children.length,
      depth,
      isExpanded,
      isMatched: matchedIds.has(provider.id),
    });
    rows.push(provider);

    if (!isExpanded) {
      markDescendantsVisited(provider.id);
      return;
    }

    const unvisitedChildren = children.filter((child) => !visitedIds.has(child.id));
    for (const child of sortSiblings(unvisitedChildren)) {
      appendNode(child, depth + 1);
    }
  };

  const roots = sortSiblings(childrenByParentId.get(null) ?? []);
  for (const root of roots) {
    appendNode(root, 0);
  }

  const remaining = includedProviders.filter((provider) => !visitedIds.has(provider.id));
  for (const provider of sortSiblings(remaining)) {
    appendNode(provider, 0);
  }

  return { rows, treeMetaById };
}

export function useProvidersListTableModel({
  collapsedProviderIds = EMPTY_PROVIDER_ID_SET,
  deferredSearch,
  filterPredicates = EMPTY_FILTER_PREDICATES,
  frozenColumns = EMPTY_STRING_LIST,
  onToggleProviderCollapsed,
  providers,
  sortStack,
  tr,
}: UseProvidersListTableModelArgs) {
  const metrics = useMemo<ProviderMetrics>(() => {
    return providers.reduce(
      (acc, provider) => {
        acc.total += 1;
        if (provider.is_active) acc.active += 1;
        if (provider.provider_type === "medical") acc.medical += 1;
        if (provider.provider_type === "non_medical") acc.nonMedical += 1;
        acc.doctors += provider.doctor_count;
        acc.patients += provider.patient_count;
        acc.appointments += provider.appointment_count;
        acc.services += provider.service_count;
        acc.conciergeRequests += provider.concierge_service_count;
        acc.openConciergeRequests += provider.open_concierge_service_count;
        return acc;
      },
      {
        active: 0,
        appointments: 0,
        conciergeRequests: 0,
        doctors: 0,
        medical: 0,
        nonMedical: 0,
        openConciergeRequests: 0,
        patients: 0,
        services: 0,
        total: 0,
      },
    );
  }, [providers]);

  const accessorColumns = useMemo(() => buildProviderColumns(tr, providers), [providers, tr]);

  const accessors = useMemo(() => {
    const map: Record<string, ColumnDef<ProviderSummary>["accessor"]> = {};
    for (const column of accessorColumns) {
      map[column.id] = column.accessor;
    }
    return map;
  }, [accessorColumns]);

  const searchAccessors = useMemo(
    () =>
      accessorColumns.reduce<ColumnDef<ProviderSummary>["accessor"][]>((acc, column) => {
        if (column.searchable) acc.push(column.accessor);
        return acc;
      }, []),
    [accessorColumns],
  );

  const treeRowsResult = useMemo(() => {
    const filtered = applyFilters(providers, filterPredicates, { accessors });
    const searched = deferredSearch.trim()
      ? searchWithIndex(buildSearchIndex(filtered, { fields: searchAccessors }), deferredSearch)
      : filtered;

    return buildProviderTreeRows({
      accessors,
      collapsedProviderIds,
      hasActiveTableQuery: filterPredicates.length > 0 || deferredSearch.trim() !== "",
      matchedProviders: searched,
      providers,
      sortStack,
    });
  }, [
    accessors,
    collapsedProviderIds,
    deferredSearch,
    filterPredicates,
    providers,
    searchAccessors,
    sortStack,
  ]);

  const baseColumns = useMemo(
    () =>
      buildProviderColumns(tr, providers, {
        onToggleProviderCollapsed,
        treeMetaById: treeRowsResult.treeMetaById,
      }),
    [onToggleProviderCollapsed, providers, tr, treeRowsResult.treeMetaById],
  );

  const columns = useMemo(() => {
    const frozenSet = new Set(frozenColumns);
    return baseColumns.map((column) => {
      const nextPinned: ColumnDef<ProviderSummary>["pinned"] = frozenSet.has(column.id)
        ? "left"
        : column.pinned === "right"
          ? "right"
          : undefined;
      if (column.pinned === nextPinned) return column;
      return { ...column, pinned: nextPinned };
    });
  }, [baseColumns, frozenColumns]);

  return {
    columns,
    metrics,
    sortedAndFilteredProviders: treeRowsResult.rows,
  };
}
