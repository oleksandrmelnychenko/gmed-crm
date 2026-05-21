import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type {
  InterpreterOption,
  PatientSummary,
  ProviderSummary,
  StaffOption,
} from "@/pages/appointments/model/types";
import { fetchProviderTaxonomy } from "@/pages/providers/data/provider-api";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";

type UseAppointmentsMetadataOptions = {
  failedLoadMessage: string;
};

const APPOINTMENT_METADATA_CACHE_TTL_MS = 60_000;

export function useAppointmentsMetadata({
  failedLoadMessage,
}: UseAppointmentsMetadataOptions) {
  const [metadataState, setMetadataState] = useState({
    patients: [] as PatientSummary[],
    providers: [] as ProviderSummary[],
    taxonomyNodes: [] as ProviderTaxonomyNode[],
    interpreters: [] as InterpreterOption[],
    staff: [] as StaffOption[],
    metadataLoading: true,
    metadataError: "",
  });

  useEffect(() => {
    let active = true;

    void (async () => {
      setMetadataState((current) => ({
        ...current,
        metadataLoading: true,
        metadataError: "",
      }));

      const metadataRequest = Promise.all([
          apiFetch<PatientSummary[]>("/patients", {
            cacheTtlMs: APPOINTMENT_METADATA_CACHE_TTL_MS,
          }).catch(() => []),
          apiFetch<ProviderSummary[]>("/providers", {
            cacheTtlMs: APPOINTMENT_METADATA_CACHE_TTL_MS,
          }).catch(() => []),
          fetchProviderTaxonomy().then((taxonomy) => taxonomy.nodes).catch(() => []),
          apiFetch<InterpreterOption[]>("/appointments/meta/interpreters", {
            cacheTtlMs: APPOINTMENT_METADATA_CACHE_TTL_MS,
          }).catch(() => []),
          apiFetch<StaffOption[]>("/appointments/meta/staff", {
            cacheTtlMs: APPOINTMENT_METADATA_CACHE_TTL_MS,
          }).catch(() => []),
        ]);

      if (!active) return;
      void metadataRequest.then(
        ([patientRows, providerRows, taxonomyRows, interpreterRows, staffRows]) => {
          if (!active) return;

          const metadataError =
            patientRows.length === 0 &&
            interpreterRows.length === 0 &&
            staffRows.length === 0
              ? failedLoadMessage
              : "";

          setMetadataState({
            patients: patientRows,
            providers: providerRows,
            taxonomyNodes: taxonomyRows,
            interpreters: interpreterRows,
            staff: staffRows,
            metadataLoading: false,
            metadataError,
          });
        },
      );
    })();

    return () => {
      active = false;
    };
  }, [failedLoadMessage]);

  return {
    patients: metadataState.patients,
    providers: metadataState.providers,
    taxonomyNodes: metadataState.taxonomyNodes,
    interpreters: metadataState.interpreters,
    staff: metadataState.staff,
    metadataLoading: metadataState.metadataLoading,
    metadataError: metadataState.metadataError,
  };
}
