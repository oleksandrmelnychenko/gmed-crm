import { useCallback, useEffect, useRef, useState } from "react";

import { useRealtimeSubscription } from "@/lib/realtime";

import { fetchLeadPayerDeclaration, saveLeadPayerDeclaration } from "../data/lead-payer-api";
import {
  payerDeclarationPayload,
  type PayerDeclarationForm,
  type PayerDeclarationResponse,
} from "./lead-payer";

/**
 * Whether a `lead.portal_updated` change touches the payer declaration row:
 * "who pays" (`payer`), the invoice recipient / payment route of sections
 * 7–8 (`billing`) and the answers of the cabinet's extra step
 * (`enhanced_details`: the self-payer's source of funds, what the patient
 * knows of a third party's funds) are stored on it.
 */
export function payerDeclarationChanged(change: unknown): boolean {
  return change === "payer" || change === "billing" || change === "enhanced_details";
}

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
  const activeLeadIdRef = useRef(leadId);
  activeLeadIdRef.current = leadId;

  const reload = useCallback(async () => {
    if (activeLeadIdRef.current !== leadId) return null;
    if (!leadId || !enabled) {
      setData(null);
      return null;
    }
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const next = await fetchLeadPayerDeclaration(leadId);
      if (request === requestRef.current && activeLeadIdRef.current === leadId) {
        setData(next);
        setError(null);
      }
      return next;
    } catch (nextError) {
      if (request === requestRef.current && activeLeadIdRef.current === leadId) setError(nextError);
      return null;
    } finally {
      if (request === requestRef.current && activeLeadIdRef.current === leadId) setLoading(false);
    }
  }, [enabled, leadId]);

  const save = useCallback(async (form: PayerDeclarationForm) => {
    if (!leadId) return null;
    // A closing section may flush its captured old lead. It must not invalidate
    // the new lead's reload, or put that old response into the current UI.
    const request = activeLeadIdRef.current === leadId ? ++requestRef.current : null;
    const next = await saveLeadPayerDeclaration(leadId, payerDeclarationPayload(form));
    if (request !== null && request === requestRef.current && activeLeadIdRef.current === leadId) {
      setData(next);
      setError(null);
    }
    return next;
  }, [leadId]);

  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);

  // The patient states who pays, where the invoice goes and how the payment
  // is made in the lead cabinet: show it at once.
  useRealtimeSubscription(["lead.portal_updated"], (event) => {
    if (!enabled || !leadId || event.entity_id !== leadId) return;
    if (payerDeclarationChanged(event.payload?.change)) void reload();
  });

  return { data, loading, error, reload, save };
}
