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
    providersError: "",
  });

  useEffect(() => {
    let active = true;

    void (async () => {
      setMetadataState((current) => ({
        ...current,
        metadataLoading: true,
        metadataError: "",
        providersError: "",
      }));

      const metadataRequest = Promise.all([
        apiFetch<PatientSummary[]>("/patients", {
          cacheTtlMs: APPOINTMENT_METADATA_CACHE_TTL_MS,
        })
          .then((rows) => ({ rows, error: "" }))
          .catch(() => ({
            rows: [] as PatientSummary[],
            error: failedLoadMessage,
          })),
        apiFetch<ProviderSummary[]>("/providers", {
          cacheTtlMs: APPOINTMENT_METADATA_CACHE_TTL_MS,
        })
          .then((rows) => ({ rows, error: "" }))
          .catch(() => ({
            rows: [] as ProviderSummary[],
            error: failedLoadMessage,
          })),
        fetchProviderTaxonomy().then((taxonomy) => taxonomy.nodes).catch(() => []),
        apiFetch<InterpreterOption[]>("/appointments/meta/interpreters", {
          cacheTtlMs: APPOINTMENT_METADATA_CACHE_TTL_MS,
        })
          .then((rows) => ({ rows, error: "" }))
          .catch(() => ({
            rows: [] as InterpreterOption[],
            error: failedLoadMessage,
          })),
        apiFetch<StaffOption[]>("/appointments/meta/staff", {
          cacheTtlMs: APPOINTMENT_METADATA_CACHE_TTL_MS,
        })
          .then((rows) => ({ rows, error: "" }))
          .catch(() => ({
            rows: [] as StaffOption[],
            error: failedLoadMessage,
          })),
      ]);

      if (!active) return;
      void metadataRequest.then(
        ([patientResult, providerResult, taxonomyRows, interpreterResult, staffResult]) => {
          if (!active) return;

          const metadataError =
            patientResult.error &&
            interpreterResult.error &&
            staffResult.error
              ? failedLoadMessage
              : "";

          setMetadataState({
            patients: patientResult.rows,
            providers: providerResult.rows,
            taxonomyNodes: taxonomyRows,
            interpreters: interpreterResult.rows,
            staff: staffResult.rows,
            metadataLoading: false,
            metadataError,
            providersError: providerResult.error,
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
    providersError: metadataState.providersError,
  };
}
