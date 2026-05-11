import { useMemo } from "react";

import { applyFilters } from "@/components/data-table/filter-logic";
import { buildSearchIndex, searchWithIndex } from "@/components/data-table/search";
import { applySort } from "@/components/data-table/sort-logic";
import type { ColumnDef, FilterPredicate, SortStack } from "@/components/data-table/types";

import { buildProviderColumns } from "../providers-columns";
import type { ProviderSummary } from "../../model/types";

type UseProvidersListTableModelArgs = {
  deferredSearch: string;
  filterPredicates: FilterPredicate[];
  frozenColumns: string[];
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

export function useProvidersListTableModel({
  deferredSearch,
  filterPredicates,
  frozenColumns,
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

  const baseColumns = useMemo(() => buildProviderColumns(tr, providers), [providers, tr]);

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

  const accessors = useMemo(() => {
    const map: Record<string, ColumnDef<ProviderSummary>["accessor"]> = {};
    for (const column of columns) {
      map[column.id] = column.accessor;
    }
    return map;
  }, [columns]);

  const searchAccessors = useMemo(
    () =>
      columns.reduce<ColumnDef<ProviderSummary>["accessor"][]>((acc, column) => {
        if (column.searchable) acc.push(column.accessor);
        return acc;
      }, []),
    [columns],
  );

  const sortedAndFilteredProviders = useMemo(() => {
    const filtered = applyFilters(providers, filterPredicates, { accessors });
    const searched = deferredSearch.trim()
      ? searchWithIndex(buildSearchIndex(filtered, { fields: searchAccessors }), deferredSearch)
      : filtered;

    return applySort(searched, sortStack, { accessors });
  }, [accessors, deferredSearch, filterPredicates, providers, searchAccessors, sortStack]);

  return {
    columns,
    metrics,
    sortedAndFilteredProviders,
  };
}
