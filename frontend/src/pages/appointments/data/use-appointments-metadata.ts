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

export type AppointmentsMetadataLoadResult<T> = {
  rows: T[];
  error: string;
};

export function buildAppointmentsMetadataState({
  failedLoadMessage,
  patientResult,
  providerResult,
  taxonomyRows,
  taxonomyError = "",
  interpreterResult,
  staffResult,
}: {
  failedLoadMessage: string;
  patientResult: AppointmentsMetadataLoadResult<PatientSummary>;
  providerResult: AppointmentsMetadataLoadResult<ProviderSummary>;
  taxonomyRows: ProviderTaxonomyNode[];
  taxonomyError?: string;
  interpreterResult: AppointmentsMetadataLoadResult<InterpreterOption>;
  staffResult: AppointmentsMetadataLoadResult<StaffOption>;
}) {
  const metadataError =
    patientResult.error ||
    taxonomyError ||
    interpreterResult.error ||
    staffResult.error
      ? failedLoadMessage
      : "";

  return {
    patients: patientResult.rows,
    providers: providerResult.rows,
    taxonomyNodes: taxonomyRows,
    interpreters: interpreterResult.rows,
    staff: staffResult.rows,
    metadataLoading: false,
    metadataError,
    providersError: providerResult.error || taxonomyError,
  };
}

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
        fetchProviderTaxonomy()
          .then((taxonomy) => ({ rows: taxonomy.nodes, error: "" }))
          .catch(() => ({
            rows: [] as ProviderTaxonomyNode[],
            error: failedLoadMessage,
          })),
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
        ([
          patientResult,
          providerResult,
          taxonomyResult,
          interpreterResult,
          staffResult,
        ]) => {
          if (!active) return;

          setMetadataState(
            buildAppointmentsMetadataState({
              failedLoadMessage,
              patientResult,
              providerResult,
              taxonomyRows: taxonomyResult.rows,
              taxonomyError: taxonomyResult.error,
              interpreterResult,
              staffResult,
            }),
          );
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
