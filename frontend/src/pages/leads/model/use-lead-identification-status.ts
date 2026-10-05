import { useCallback, useEffect, useRef, useState } from "react";

import { useRealtimeSubscription } from "@/lib/realtime";

import { fetchLeadIdentificationStatus, setLeadOwnAccountPayment } from "../data/lead-identification-api";
import type { IdentificationSubject, LeadIdentificationStatus } from "./lead-identification";

/**
 * Loads the identification status of a lead (qualified signatures and the
 * confirmed own-account payments) and keeps it fresh. `documents` and
 * `payerVersion` are what the status depends on outside this hook — the
 * lead's documents (a signature was completed) and the payer declaration (a
 * third party pays or no longer does): the status is loaded again when either
 * changes. A failed load leaves the last known state and reports the error.
 */
export function useLeadIdentificationStatus(
  leadId: string | null | undefined,
  documents?: unknown,
  payerVersion?: string | null,
) {
  const [status, setStatus] = useState<LeadIdentificationStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    if (!leadId) {
      setStatus(null);
      return;
    }
    const request = ++requestRef.current;
    try {
      const next = await fetchLeadIdentificationStatus(leadId);
      if (request !== requestRef.current) return;
      setStatus(next);
      setError(null);
    } catch (nextError) {
      if (request === requestRef.current) setError(nextError);
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
  }, [leadId]);

  useEffect(() => {
    void reload();
  }, [reload, documents, payerVersion]);

  // A colleague confirmed the payment, or the patient named a payer in the cabinet.
  useRealtimeSubscription(["lead.updated", "lead.portal_updated"], (event) => {
    if (!leadId || event.entity_id !== leadId) return;
    const changed = event.type === "lead.updated"
      ? event.payload?.identification_updated === true
      : event.payload?.change === "payer";
    if (changed) void reload();
  });

  return { status, error, reload, setOwnAccountPayment };
}
