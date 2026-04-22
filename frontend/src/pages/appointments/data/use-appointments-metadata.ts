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
          apiFetch<PatientSummary[]>("/patients").catch(() => []),
          apiFetch<ProviderSummary[]>("/providers").catch(() => []),
          apiFetch<InterpreterOption[]>("/appointments/meta/interpreters").catch(
            () => [],
          ),
          apiFetch<StaffOption[]>("/appointments/meta/staff").catch(() => []),
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
