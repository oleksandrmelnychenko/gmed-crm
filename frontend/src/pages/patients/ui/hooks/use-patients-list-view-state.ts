import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useSearchParams } from "react-router-dom";

import type { DensityLevel, FilterPredicate, SortStack } from "@/components/data-table/types";
import { useLocalStorage, useVersionedLocalStorage } from "@/components/data-table/use-local-storage";
import { useResponsiveViewMode } from "@/components/data-table/use-responsive-view-mode";
import { readDataTableState, writeDataTableState } from "@/components/data-table/url-state";

import {
  DEFAULT_PATIENT_FILTERS as DEFAULT_FILTERS,
  type PatientFilters,
} from "../../model/list-model";
import { DEFAULT_PATIENT_HIDDEN_COLUMNS } from "../patients-columns";

type QueryPatch = Record<string, string | null>;

export function usePatientsListViewState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<PatientFilters>(() => {
    if (typeof window === "undefined") return DEFAULT_FILTERS;
    const params = new URLSearchParams(window.location.search);
    return {
      ...DEFAULT_FILTERS,
      providerId: params.get("provider") ?? "",
      doctorId: params.get("doctor") ?? "",
    };
  });
  const deferredSearch = useDeferredValue(filters.search);
  const [listVersion, setListVersion] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return Boolean(new URLSearchParams(window.location.search).get("patient"));
  });
  const [selectedId, setSelectedId] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("patient") ?? "";
  });
  const [detailVersion, setDetailVersion] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [, startFilterTransition] = useTransition();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [filterPredicates, setFilterPredicatesState] = useState<FilterPredicate[]>(() => {
    if (typeof window === "undefined") return [];
    return readDataTableState(new URLSearchParams(window.location.search)).filters ?? [];
  });
  const [sortStack, setSortStackState] = useState<SortStack>(() => {
    if (typeof window === "undefined") return [{ field: "created_at", dir: "desc" }];
    const url = readDataTableState(new URLSearchParams(window.location.search));
    return url.sort ?? [{ field: "created_at", dir: "desc" }];
  });
  const [hiddenColumns, setHiddenColumns] = useVersionedLocalStorage<string[]>(
    "patients.hiddenColumns",
    DEFAULT_PATIENT_HIDDEN_COLUMNS,
    1,
  );
  const [density, setDensity] = useLocalStorage<DensityLevel>("patients.density", "compact");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const viewMode = useResponsiveViewMode();

  const syncQuery = useCallback((next: QueryPatch) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setFilterPredicates = useCallback((next: FilterPredicate[]) => {
    startFilterTransition(() => {
      setFilterPredicatesState(next);
    });
    const params = writeDataTableState(new URLSearchParams(searchParams), { filters: next });
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams, startFilterTransition]);

  const setSortStack = useCallback((next: SortStack) => {
    startFilterTransition(() => {
      setSortStackState(next);
    });
    const params = writeDataTableState(new URLSearchParams(searchParams), { sort: next });
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams, startFilterTransition]);

  const refreshList = useCallback(() => {
    setListVersion((current) => current + 1);
  }, []);

  const refreshDetail = useCallback(() => {
    setDetailVersion((current) => current + 1);
  }, []);

  const handleCreateOpenChange = useCallback((open: boolean) => {
    setCreateOpen(open);
  }, []);

  const handleDetailOpenChange = useCallback((open: boolean) => {
    setDetailOpen(open);
    if (!open) {
      setSelectedId("");
      syncQuery({ patient: null });
    }
  }, [syncQuery]);

  const openPatient = useCallback((patientId: string) => {
    setSelectedId(patientId);
    setDetailOpen(true);
    syncQuery({ patient: patientId });
  }, [syncQuery]);

  const clearAllFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setFilterPredicatesState([]);
    syncQuery({ provider: null, doctor: null, patient: null });
  }, [syncQuery]);

  return {
    clearAllFilters,
    createOpen,
    deferredSearch,
    density,
    detailOpen,
    detailVersion,
    filterPredicates,
    filters,
    handleCreateOpenChange,
    handleDetailOpenChange,
    helpOpen,
    hiddenColumns,
    listVersion,
    openPatient,
    refreshDetail,
    refreshList,
    searchInputRef,
    selectedId,
    selectedIds,
    setDensity,
    setFilterPredicates,
    setFilters,
    setHelpOpen,
    setHiddenColumns,
    setSelectedIds,
    setSortStack,
    sortStack,
    syncQuery,
    viewMode,
  };
}
