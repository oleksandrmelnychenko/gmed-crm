import { startTransition, useEffect, useReducer } from "react";

import { apiFetch } from "@/lib/api";

import type { PatientLookupItem } from "../model/detail-tab-types";

type UsePatientLookupOptionsArgs = {
  enabled: boolean;
};

const PATIENT_LOOKUP_CACHE_TTL_MS = 60_000;

type LookupState = {
  patientOptions: PatientLookupItem[];
  settledKey: string;
};

const EMPTY_LOOKUP_STATE: LookupState = {
  patientOptions: [],
  settledKey: "",
};

function lookupReducer(_state: LookupState, nextState: LookupState) {
  return nextState;
}

export function usePatientLookupOptions({
  enabled,
}: UsePatientLookupOptionsArgs) {
  const [lookupState, dispatchLookupState] = useReducer(
    lookupReducer,
    EMPTY_LOOKUP_STATE,
  );

  const requestKey = enabled ? "active-patient-lookup" : "";

  useEffect(() => {
    if (!requestKey) {
      startTransition(() => {
        dispatchLookupState(EMPTY_LOOKUP_STATE);
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
          dispatchLookupState({ patientOptions: items, settledKey: requestKey });
        });
      })
      .catch(() => {
        if (cancelled) return;
        startTransition(() => {
          dispatchLookupState({ patientOptions: [], settledKey: requestKey });
        });
      });

    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const ready = lookupState.settledKey === requestKey;

  return {
    patientOptions: ready ? lookupState.patientOptions : [],
    patientOptionsLoading: Boolean(requestKey) && !ready,
  };
}
