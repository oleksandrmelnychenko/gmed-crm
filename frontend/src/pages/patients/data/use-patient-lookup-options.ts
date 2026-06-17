import { startTransition, useEffect, useReducer } from "react";

import { apiFetch } from "@/lib/api";

import type { PatientLookupItem } from "../model/detail-tab-types";

type UsePatientLookupOptionsArgs = {
  enabled: boolean;
  /** Free-text term sent to the server (`?search=`). Debounce/defer before passing. */
  search?: string;
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
  search = "",
}: UsePatientLookupOptionsArgs) {
  const [lookupState, dispatchLookupState] = useReducer(
    lookupReducer,
    EMPTY_LOOKUP_STATE,
  );

  const normalizedSearch = search.trim();
  const requestKey = enabled
    ? `active-patient-lookup:${normalizedSearch.toLowerCase()}`
    : "";

  useEffect(() => {
    if (!requestKey) {
      startTransition(() => {
        dispatchLookupState(EMPTY_LOOKUP_STATE);
      });
      return;
    }

    let cancelled = false;
    const url = normalizedSearch
      ? `/patients?active_only=true&search=${encodeURIComponent(normalizedSearch)}`
      : "/patients?active_only=true";

    apiFetch<PatientLookupItem[]>(url, {
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
  }, [requestKey, normalizedSearch]);

  const ready = lookupState.settledKey === requestKey;

  return {
    // Keep the last settled options visible while a new search is loading so the
    // combobox does not flash empty on every keystroke.
    patientOptions: lookupState.patientOptions,
    patientOptionsLoading: Boolean(requestKey) && !ready,
  };
}
