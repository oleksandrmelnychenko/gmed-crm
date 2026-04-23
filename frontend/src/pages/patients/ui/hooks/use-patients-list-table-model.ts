import { useMemo } from "react";

import { applyFilters } from "@/components/data-table/filter-logic";
import { buildSearchIndex, searchWithIndex } from "@/components/data-table/search";
import { applySort } from "@/components/data-table/sort-logic";
import type { ColumnDef, FilterPredicate, SortStack } from "@/components/data-table/types";

import { buildPatientColumns } from "../patients-columns";
import type { PatientSummary } from "../../model/list-model";

type UsePatientsListTableModelArgs = {
  deferredSearch: string;
  filterPredicates: FilterPredicate[];
  patients: PatientSummary[];
  sortStack: SortStack;
  tr: Record<string, string>;
};

type PatientsMetrics = {
  active: number;
  privateCount: number;
  selfPay: number;
  total: number;
};

export function usePatientsListTableModel({
  deferredSearch,
  filterPredicates,
  patients,
  sortStack,
  tr,
}: UsePatientsListTableModelArgs) {
  const metrics = useMemo<PatientsMetrics>(() => {
    return patients.reduce(
      (acc, patient) => {
        acc.total += 1;
        if (patient.is_active) acc.active += 1;
        if (patient.insurance_type === "private") acc.privateCount += 1;
        if (patient.insurance_type === "self_pay") acc.selfPay += 1;
        return acc;
      },
      { total: 0, active: 0, privateCount: 0, selfPay: 0 },
    );
  }, [patients]);

  const columns = useMemo(() => buildPatientColumns(tr, patients), [tr, patients]);

  const accessors = useMemo(() => {
    const map: Record<string, ColumnDef<PatientSummary>["accessor"]> = {};
    for (const column of columns) {
      map[column.id] = column.accessor;
    }
    return map;
  }, [columns]);

  const searchAccessors = useMemo(
    () => columns.filter((column) => column.searchable).map((column) => column.accessor),
    [columns],
  );

  const sortedAndFilteredPatients = useMemo(() => {
    const filtered = applyFilters(patients, filterPredicates, { accessors });
    const searched = deferredSearch.trim()
      ? searchWithIndex(buildSearchIndex(filtered, { fields: searchAccessors }), deferredSearch)
      : filtered;

    return applySort(searched, sortStack, { accessors });
  }, [accessors, deferredSearch, filterPredicates, patients, searchAccessors, sortStack]);

  return {
    columns,
    metrics,
    sortedAndFilteredPatients,
  };
}
