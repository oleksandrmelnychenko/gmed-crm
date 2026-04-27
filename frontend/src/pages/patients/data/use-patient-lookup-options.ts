import { startTransition, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

import type { PatientLookupItem } from "../model/detail-tab-types";

type UsePatientLookupOptionsArgs = {
  enabled: boolean;
};

const PATIENT_LOOKUP_CACHE_TTL_MS = 60_000;

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

    let cancelled = false;

    apiFetch<PatientLookupItem[]>("/patients?active_only=true", {
      cacheTtlMs: PATIENT_LOOKUP_CACHE_TTL_MS,
    })
      .then((items) => {
        if (cancelled) return;
        startTransition(() => {
          setPatientOptions(items);
          setSettledKey(requestKey);
        });
      })
      .catch(() => {
        if (cancelled) return;
        startTransition(() => {
          setPatientOptions([]);
          setSettledKey(requestKey);
        });
      });

    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const ready = settledKey === requestKey;

  return {
    patientOptions: ready ? patientOptions : [],
    patientOptionsLoading: Boolean(requestKey) && !ready,
  };
}
