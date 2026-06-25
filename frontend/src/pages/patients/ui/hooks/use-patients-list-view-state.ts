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
import { useSecurePersistedState } from "@/lib/secure-persist";

import {
  DEFAULT_PATIENT_FILTERS as DEFAULT_FILTERS,
  type PatientFilters,
} from "../../model/list-model";

type PersistedPatientFilters = Pick<PatientFilters, "activeOnly" | "providerId" | "doctorId">;

function isValidPersistedFilters(value: unknown): value is PersistedPatientFilters {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.activeOnly === "string" &&
    typeof v.providerId === "string" &&
    typeof v.doctorId === "string"
  );
}
import {
  DEFAULT_PATIENT_FROZEN_COLUMNS,
  DEFAULT_PATIENT_HIDDEN_COLUMNS,
} from "../patients-columns";

type QueryPatch = Record<string, string | null>;
type QuerySyncOptions = {
  replace?: boolean;
};

export function usePatientsListViewState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [persistedFilters, setPersistedFilters] = useSecurePersistedState<PersistedPatientFilters>(
    "patients.filters",
    {
      activeOnly: DEFAULT_FILTERS.activeOnly,
      providerId: DEFAULT_FILTERS.providerId,
      doctorId: DEFAULT_FILTERS.doctorId,
    },
    { schemaVersion: 1, validate: isValidPersistedFilters },
  );
  const [filters, setFiltersState] = useState<PatientFilters>(() => {
    if (typeof window === "undefined") return DEFAULT_FILTERS;
    const params = new URLSearchParams(window.location.search);
    const tableState = readDataTableState(params);
    const activeParam = params.get("active");
    const providerParam = params.get("provider");
    const doctorParam = params.get("doctor");
    return {
      ...DEFAULT_FILTERS,
      search: tableState.search ?? "",
      activeOnly:
        activeParam === "" || activeParam === "false" || activeParam === "true"
          ? activeParam
          : persistedFilters.activeOnly,
      providerId: providerParam ?? persistedFilters.providerId,
      doctorId: doctorParam ?? persistedFilters.doctorId,
    };
  });
  const setFilters: typeof setFiltersState = useCallback(
    (value) => {
      setFiltersState((prev) => {
        const next = typeof value === "function" ? (value as (p: PatientFilters) => PatientFilters)(prev) : value;
        setPersistedFilters({
          activeOnly: next.activeOnly,
          providerId: next.providerId,
          doctorId: next.doctorId,
        });
        return next;
      });
    },
    [setPersistedFilters],
  );
  const deferredSearch = useDeferredValue(filters.search);
  const [listVersion, setListVersion] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
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
    2,
  );
  const [frozenColumns, setFrozenColumns] = useVersionedLocalStorage<string[]>(
    "patients.frozenColumns",
    DEFAULT_PATIENT_FROZEN_COLUMNS,
    1,
  );
  const [density, setDensity] = useLocalStorage<DensityLevel>("patients.density", "comfortable");
  const viewMode = useResponsiveViewMode();
  const patientParam = searchParams.get("patient") ?? "";
  const detailOpen = Boolean(patientParam);
  const selectedId = patientParam;

  const syncQuery = useCallback(
    (next: QueryPatch, options: QuerySyncOptions = {}) => {
      const params = new URLSearchParams(searchParams);
      Object.entries(next).forEach(([key, value]) => {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      });
      setSearchParams(params, { replace: options.replace ?? true });
    },
    [searchParams, setSearchParams],
  );

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
    if (!open) {
      syncQuery({ patient: null }, { replace: false });
    }
  }, [syncQuery]);

  const openPatient = useCallback((patientId: string) => {
    syncQuery({ patient: patientId }, { replace: false });
  }, [syncQuery]);

  const clearAllFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setFilterPredicatesState([]);
    const params = writeDataTableState(new URLSearchParams(searchParams), {
      filters: [],
      search: "",
    });
    params.delete("provider");
    params.delete("doctor");
    params.delete("active");
    params.delete("patient");
    setSearchParams(params, { replace: true });
  }, [searchParams, setFilters, setSearchParams]);

  return {
    clearAllFilters,
    createOpen,
    deferredSearch,
    density,
    detailOpen,
    detailVersion,
    filterPredicates,
    filters,
    frozenColumns,
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
    setDensity,
    setFilterPredicates,
    setFilters,
    setFrozenColumns,
    setHelpOpen,
    setHiddenColumns,
    setSortStack,
    sortStack,
    syncQuery,
    viewMode,
  };
}
