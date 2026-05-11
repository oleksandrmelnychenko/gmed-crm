import { startTransition, useCallback, useEffect, useReducer } from "react";

import { apiFetch } from "@/lib/api";

import type { DunningEvent } from "../model/detail-tab-types";

type DunningState = {
  dunningEvents: DunningEvent[];
  settledKey: string;
};

type DunningAction =
  | { type: "replace"; state: DunningState }
  | { type: "append"; event: DunningEvent };

const EMPTY_DUNNING_STATE: DunningState = {
  dunningEvents: [],
  settledKey: "",
};

function dunningReducer(state: DunningState, action: DunningAction) {
  switch (action.type) {
    case "append":
      return {
        ...state,
        dunningEvents: [...state.dunningEvents, action.event],
      };
    case "replace":
      return action.state;
  }
}

export function usePatientInvoiceDunningEvents(invoiceId: string) {
  const [dunningState, dispatchDunningState] = useReducer(
    dunningReducer,
    EMPTY_DUNNING_STATE,
  );

  useEffect(() => {
    if (!invoiceId) {
      startTransition(() => {
        dispatchDunningState({ type: "replace", state: EMPTY_DUNNING_STATE });
      });
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    apiFetch<DunningEvent[]>(`/invoices/${invoiceId}/dunning`, { signal })
      .then((items) => {
        if (signal.aborted) return;
        startTransition(() => {
          dispatchDunningState({
            type: "replace",
            state: { dunningEvents: items, settledKey: invoiceId },
          });
        });
      })
      .catch(() => {
        if (signal.aborted) return;
        startTransition(() => {
          dispatchDunningState({
            type: "replace",
            state: { dunningEvents: [], settledKey: invoiceId },
          });
        });
      });

    return () => {
      controller.abort();
    };
  }, [invoiceId]);

  const appendDunningEvent = useCallback((event: DunningEvent) => {
    dispatchDunningState({ type: "append", event });
  }, []);

  const ready = dunningState.settledKey === invoiceId;

  return {
    appendDunningEvent,
    dunningEvents: ready ? dunningState.dunningEvents : [],
    dunningEventsLoading: Boolean(invoiceId) && !ready,
  };
}
