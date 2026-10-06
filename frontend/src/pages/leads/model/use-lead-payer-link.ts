import { useCallback, useEffect, useRef, useState } from "react";

import { ApiRequestError } from "@/lib/api";
import { useRealtimeSubscription } from "@/lib/realtime";

import {
  fetchLeadPayerLink,
  revokeLeadPayerLink,
  saveLeadPayerEstimatedTotal,
  sendLeadPayerLink,
  type LeadPayerLinkState,
  type PayerLinkSendInput,
} from "../data/lead-payer-link-api";
import { payerLinkChanged } from "./lead-payer-link";

/** What the wizard hands to the payer section and to "Данные от пациента". */
export type LeadPayerLinkController = {
  /** The state; null while loading, on an older server, or after a failed first load. */
  data: LeadPayerLinkState | null;
  loading: boolean;
  /** The last failed load; a 404 (older server) is not an error. */
  error: unknown;
  reload: () => Promise<LeadPayerLinkState | null>;
  send: (input: PayerLinkSendInput) => Promise<LeadPayerLinkState | null>;
  revoke: () => Promise<LeadPayerLinkState | null>;
  saveEstimatedTotal: (value: string | null) => Promise<LeadPayerLinkState | null>;
};

/**
 * Loads the payer link of a lead (`GET /leads/{id}/payer-link`) and keeps it
 * fresh: the payer's writes, the lead's submit and another payer arrive as
 * `lead.portal_updated`. The writes answer with the state; an answer that is
 * not one is followed by a reload. A server without the endpoint (404) reads
 * as "no payer link": nothing is shown.
 */
export function useLeadPayerLink(leadId: string | null | undefined, enabled = true): LeadPayerLinkController {
  const [data, setData] = useState<LeadPayerLinkState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    if (!leadId || !enabled) {
      setData(null);
      return null;
    }
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const next = await fetchLeadPayerLink(leadId);
      if (request === requestRef.current) {
        setData(next);
        setError(null);
      }
      return next;
    } catch (nextError) {
      if (request === requestRef.current) {
        const olderServer = nextError instanceof ApiRequestError && nextError.status === 404;
        if (olderServer) setData(null);
        setError(olderServer ? null : nextError);
      }
      return null;
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [enabled, leadId]);

  /** A write: its answer replaces the state, or the state is loaded afresh. */
  const write = useCallback(
    async (action: (id: string) => Promise<LeadPayerLinkState | null>) => {
      if (!leadId) return null;
      // A load still on its way would bring the state of before: the answer of the write wins.
      const request = ++requestRef.current;
      let next: LeadPayerLinkState | null;
      try {
        next = await action(leadId);
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
      if (!next) return reload();
      if (request === requestRef.current) {
        setData(next);
        setError(null);
      }
      return next;
    },
    [leadId, reload],
  );

  const send = useCallback((input: PayerLinkSendInput) => write((id) => sendLeadPayerLink(id, input)), [write]);
  const revoke = useCallback(() => write((id) => revokeLeadPayerLink(id)), [write]);
  const saveEstimatedTotal = useCallback(
    (value: string | null) => write((id) => saveLeadPayerEstimatedTotal(id, value)),
    [write],
  );

  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);

  useRealtimeSubscription(["lead.portal_updated"], (event) => {
    if (!enabled || !leadId || event.entity_id !== leadId) return;
    if (payerLinkChanged(event.payload?.change)) void reload();
  });

  return { data, loading, error, reload, send, revoke, saveEstimatedTotal };
}
