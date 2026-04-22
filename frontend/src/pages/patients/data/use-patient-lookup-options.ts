import { startTransition, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

import type { PatientLookupItem } from "../model/detail-tab-types";

type UsePatientLookupOptionsArgs = {
  enabled: boolean;
};

export function usePatientLookupOptions({
  enabled,
}: UsePatientLookupOptionsArgs) {
  const [patientOptions, setPatientOptions] = useState<PatientLookupItem[]>([]);
  const [settledKey, setSettledKey] = useState("");

  const requestKey = enabled ? "active-patient-lookup" : "";

  useEffect(() => {
    if (!requestKey) {
      startTransition(() => {
        setPatientOptions([]);
        setSettledKey("");
      });
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    apiFetch<PatientLookupItem[]>("/patients?active_only=true", { signal })
      .then((items) => {
        if (signal.aborted) return;
        startTransition(() => {
          setPatientOptions(items);
          setSettledKey(requestKey);
        });
      })
      .catch(() => {
        if (signal.aborted) return;
        startTransition(() => {
          setPatientOptions([]);
          setSettledKey(requestKey);
        });
      });

    return () => {
      controller.abort();
    };
  }, [requestKey]);

  const ready = settledKey === requestKey;

  return {
    patientOptions: ready ? patientOptions : [],
    patientOptionsLoading: Boolean(requestKey) && !ready,
  };
}
