import { useCallback, useEffect, useRef, useState } from "react";

import { useRealtimeSubscription } from "@/lib/realtime";

import { fetchLeadIdentificationStatus, setLeadOwnAccountPayment } from "../data/lead-identification-api";
import type { IdentificationSubject, LeadIdentificationStatus } from "./lead-identification";

/** Which changes of a lead make its identification status out of date. */
export function identificationStatusChanged(event: { type: string; payload?: Record<string, unknown> }): boolean {
  if (event.type === "lead.updated") return event.payload?.identification_updated === true;
  if (event.type !== "lead.portal_updated") return false;
  // The patient named a payer, or somebody changed who represents the lead.
  return event.payload?.change === "payer" || event.payload?.change === "representation";
}

/**
 * Loads the identification status of a lead (qualified signatures and the
 * confirmed own-account payments) and keeps it fresh. `documents`,
 * `payerVersion` and `representationVersion` are what the status depends on
 * outside this hook — the lead's documents (a signature was completed), the
 * payer declaration (a third party pays or no longer does) and what the wizard
 * saved about the legal representatives of a minor: the status is loaded again
 * when one of them changes. A failed load leaves the last known state and
 * reports the error.
 */
export function useLeadIdentificationStatus(
  leadId: string | null | undefined,
  documents?: unknown,
  payerVersion?: string | null,
  representationVersion?: unknown,
) {
  const [status, setStatus] = useState<LeadIdentificationStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Whether the server has answered for this lead (with a status or without one).
  const [loaded, setLoaded] = useState(false);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    if (!leadId) {
      setStatus(null);
      setLoaded(false);
      return;
    }
    const request = ++requestRef.current;
    try {
      const next = await fetchLeadIdentificationStatus(leadId);
      if (request !== requestRef.current) return;
      setStatus(next);
      setError(null);
      setLoaded(true);
    } catch (nextError) {
      if (request !== requestRef.current) return;
      setError(nextError);
      setLoaded(true);
    }
  }, [leadId]);

  /** Confirms or takes back the own-account payment of one person; throws when the server refuses. */
  const setOwnAccountPayment = useCallback(async (subject: IdentificationSubject, confirmed: boolean) => {
    if (!leadId) return;
    const request = ++requestRef.current;
    const next = await setLeadOwnAccountPayment(leadId, subject, confirmed);
    if (request !== requestRef.current) return;
    setStatus(next);
    setError(null);
  }, [leadId]);

  useEffect(() => {
    setStatus(null);
    setError(null);
    setLoaded(false);
  }, [leadId]);

  useEffect(() => {
    void reload();
  }, [reload, documents, payerVersion, representationVersion]);

  // A colleague confirmed the payment, the patient named a payer in the
  // cabinet, or a parent changed who represents the child.
  useRealtimeSubscription(["lead.updated", "lead.portal_updated"], (event) => {
    if (!leadId || event.entity_id !== leadId) return;
    if (identificationStatusChanged(event)) void reload();
  });

  return { status, error, loaded, reload, setOwnAccountPayment };
}

export type LeadIdentificationStatusState = ReturnType<typeof useLeadIdentificationStatus>;
