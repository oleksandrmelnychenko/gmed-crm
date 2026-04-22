import { startTransition, useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";

import {
  buildPatientsPath,
  type DoctorOption,
  type PatientFilters,
  type PatientSummary,
  type ProviderOption,
} from "../model/list-model";

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
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [listBusy, setListBusy] = useState(true);
  const [listError, setListError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const patientsPath = useMemo(() => buildPatientsPath(filters), [filters]);
  const doctors = useMemo(
    () => (filters.providerId ? doctorOptions : []),
    [doctorOptions, filters.providerId]
  );

  useEffect(() => {
    if (!canViewPage) return;
    let cancelled = false;

    void apiFetch<ProviderOption[]>("/providers")
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
    void apiFetch<DoctorOption[]>(`/providers/${filters.providerId}/doctors`)
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
    if (!canViewPage) return;

    let cancelled = false;

    void apiFetch<PatientSummary[]>(patientsPath)
      .then((items) => {
        if (!cancelled) {
          const filtered = filters.activeOnly === "false"
            ? items.filter((patient) => !patient.is_active)
            : items;
          startTransition(() => setPatients(filtered));
          setListError("");
          setLastUpdated(new Date());
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setListError(error instanceof Error ? error.message : commonFailedLoad);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setListBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canViewPage, commonFailedLoad, filters.activeOnly, listVersion, patientsPath]);

  return {
    doctors,
    lastUpdated,
    listBusy,
    listError,
    patients,
    providers,
    setListError,
    setPatients,
  };
}
