import { startTransition, useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

import type { DunningEvent } from "../model/detail-tab-types";

export function usePatientInvoiceDunningEvents(invoiceId: string) {
  const [dunningEvents, setDunningEvents] = useState<DunningEvent[]>([]);
  const [settledKey, setSettledKey] = useState("");

  useEffect(() => {
    if (!invoiceId) {
      startTransition(() => {
        setDunningEvents([]);
        setSettledKey("");
      });
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    apiFetch<DunningEvent[]>(`/invoices/${invoiceId}/dunning`, { signal })
      .then((items) => {
        if (signal.aborted) return;
        startTransition(() => {
          setDunningEvents(items);
          setSettledKey(invoiceId);
        });
      })
      .catch(() => {
        if (signal.aborted) return;
        startTransition(() => {
          setDunningEvents([]);
          setSettledKey(invoiceId);
        });
      });

    return () => {
      controller.abort();
    };
  }, [invoiceId]);

  const appendDunningEvent = useCallback((event: DunningEvent) => {
    setDunningEvents((current) => [...current, event]);
  }, []);

  const ready = settledKey === invoiceId;

  return {
    appendDunningEvent,
    dunningEvents: ready ? dunningEvents : [],
    dunningEventsLoading: Boolean(invoiceId) && !ready,
  };
}
