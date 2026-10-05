import { useCallback, useEffect, useRef, useState } from "react";

import { useRealtimeSubscription } from "@/lib/realtime";

import { fetchLeadPayerDeclaration, saveLeadPayerDeclaration } from "../data/lead-payer-api";
import {
  payerDeclarationPayload,
  type PayerDeclarationForm,
  type PayerDeclarationResponse,
} from "./lead-payer";

/**
 * Loads the payer declaration of a lead and keeps it fresh: `reload` after
 * anything that changes the order, its signatures or the cost assumption
 * document, `save` for the declaration itself. A failed load leaves the last
 * known state and reports the error.
 */
export function useLeadPayerDeclaration(leadId: string | null | undefined, enabled = true) {
  const [data, setData] = useState<PayerDeclarationResponse | null>(null);
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
      const next = await fetchLeadPayerDeclaration(leadId);
      if (request === requestRef.current) {
        setData(next);
        setError(null);
      }
      return next;
    } catch (nextError) {
      if (request === requestRef.current) setError(nextError);
      return null;
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [enabled, leadId]);

  const save = useCallback(async (form: PayerDeclarationForm) => {
    if (!leadId) return null;
    const request = ++requestRef.current;
    const next = await saveLeadPayerDeclaration(leadId, payerDeclarationPayload(form));
    if (request === requestRef.current) {
      setData(next);
      setError(null);
    }
    return next;
  }, [leadId]);

  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);

  // The patient states who pays in the lead cabinet: show it at once.
  useRealtimeSubscription(["lead.portal_updated"], (event) => {
    if (!enabled || !leadId || event.entity_id !== leadId) return;
    if (event.payload?.change === "payer") void reload();
  });

  return { data, loading, error, reload, save };
}
