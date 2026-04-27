import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type {
  InterpreterOption,
  PatientSummary,
  ProviderSummary,
  StaffOption,
} from "@/pages/appointments/model/types";

type UseAppointmentsMetadataOptions = {
  failedLoadMessage: string;
};

const APPOINTMENT_METADATA_CACHE_TTL_MS = 60_000;

export function useAppointmentsMetadata({
  failedLoadMessage,
}: UseAppointmentsMetadataOptions) {
  const [patients, setPatients] = useState<PatientSummary[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [interpreters, setInterpreters] = useState<InterpreterOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [metadataError, setMetadataError] = useState("");

  useEffect(() => {
    let active = true;

    void (async () => {
      setMetadataLoading(true);
      setMetadataError("");

      const [patientRows, providerRows, interpreterRows, staffRows] =
        await Promise.all([
          apiFetch<PatientSummary[]>("/patients", {
            cacheTtlMs: APPOINTMENT_METADATA_CACHE_TTL_MS,
          }).catch(() => []),
          apiFetch<ProviderSummary[]>("/providers", {
            cacheTtlMs: APPOINTMENT_METADATA_CACHE_TTL_MS,
          }).catch(() => []),
          apiFetch<InterpreterOption[]>("/appointments/meta/interpreters", {
            cacheTtlMs: APPOINTMENT_METADATA_CACHE_TTL_MS,
          }).catch(() => []),
          apiFetch<StaffOption[]>("/appointments/meta/staff", {
            cacheTtlMs: APPOINTMENT_METADATA_CACHE_TTL_MS,
          }).catch(() => []),
        ]);

      if (!active) return;

      setPatients(patientRows);
      setProviders(providerRows);
      setInterpreters(interpreterRows);
      setStaff(staffRows);

      if (
        patientRows.length === 0 &&
        interpreterRows.length === 0 &&
        staffRows.length === 0
      ) {
        setMetadataError(failedLoadMessage);
      }

      setMetadataLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [failedLoadMessage]);

  return {
    patients,
    providers,
    interpreters,
    staff,
    metadataLoading,
    metadataError,
  };
}
