import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type SetStateAction,
} from "react";

import { apiFetch } from "@/lib/api";

import {
  buildPatientsPath,
  type DoctorOption,
  type PatientFilters,
  type PatientSummary,
  type ProviderOption,
} from "../model/list-model";

const PATIENTS_LOOKUP_CACHE_TTL_MS = 60_000;

type PatientsListState = {
  patients: PatientSummary[];
  listBusy: boolean;
  listError: string;
  lastUpdated: Date | null;
};

type PatientsListAction =
  | Partial<PatientsListState>
  | ((state: PatientsListState) => Partial<PatientsListState>);

const INITIAL_PATIENTS_LIST_STATE: PatientsListState = {
  patients: [],
  listBusy: true,
  listError: "",
  lastUpdated: null,
};

function patientsListReducer(
  state: PatientsListState,
  action: PatientsListAction,
) {
  const patch = typeof action === "function" ? action(state) : action;
  return { ...state, ...patch };
}

type UsePatientsListDataArgs = {
  canViewPage: boolean;
  commonFailedLoad: string;
  filters: PatientFilters;
  listVersion: number;
};

export function usePatientsListData({
  canViewPage,
  commonFailedLoad,
  filters,
  listVersion,
}: UsePatientsListDataArgs) {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [doctorOptions, setDoctorOptions] = useState<DoctorOption[]>([]);
  const [listState, dispatchListState] = useReducer(
    patientsListReducer,
    INITIAL_PATIENTS_LIST_STATE,
  );

  const patientsPath = useMemo(() => buildPatientsPath(filters), [filters]);
  const doctors = useMemo(
    () => (filters.providerId ? doctorOptions : []),
    [doctorOptions, filters.providerId]
  );

  const setPatients = useCallback(
    (nextPatients: SetStateAction<PatientSummary[]>) => {
      dispatchListState((current) => ({
        patients:
          typeof nextPatients === "function"
            ? nextPatients(current.patients)
            : nextPatients,
      }));
    },
    [],
  );

  const setListError = useCallback((listError: string) => {
    dispatchListState({ listError });
  }, []);

  useEffect(() => {
    if (!canViewPage) return;
    let cancelled = false;

    void apiFetch<ProviderOption[]>("/providers", {
      cacheTtlMs: PATIENTS_LOOKUP_CACHE_TTL_MS,
    })
      .then((items) => {
        if (!cancelled) {
          startTransition(() => setProviders(items));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviders([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canViewPage]);

  useEffect(() => {
    if (!filters.providerId) return;

    let cancelled = false;
    void apiFetch<DoctorOption[]>(`/providers/${filters.providerId}/doctors`, {
      cacheTtlMs: PATIENTS_LOOKUP_CACHE_TTL_MS,
    })
      .then((items) => {
        if (!cancelled) {
          startTransition(() => setDoctorOptions(items));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDoctorOptions([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filters.providerId]);

  useEffect(() => {
    if (!canViewPage) {
      dispatchListState({
        patients: [],
        listBusy: false,
        listError: "",
      });
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    dispatchListState({
      listBusy: true,
      listError: "",
    });

    void apiFetch<PatientSummary[]>(patientsPath, { signal })
      .then((items) => {
        if (signal.aborted) return;
        const filtered = filters.activeOnly === "false"
          ? items.filter((patient) => !patient.is_active)
          : filters.activeOnly === "true"
            ? items.filter((patient) => patient.is_active)
          : items;
        startTransition(() => {
          dispatchListState({
            patients: filtered,
            listError: "",
            lastUpdated: new Date(),
            listBusy: false,
          });
        });
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        dispatchListState({
          listError: error instanceof Error ? error.message : commonFailedLoad,
          listBusy: false,
        });
      });

    return () => {
      controller.abort();
    };
  }, [canViewPage, commonFailedLoad, filters.activeOnly, listVersion, patientsPath]);

  return {
    doctors,
    lastUpdated: listState.lastUpdated,
    listBusy: listState.listBusy,
    listError: listState.listError,
    patients: listState.patients,
    providers,
    setListError,
    setPatients,
  };
}
