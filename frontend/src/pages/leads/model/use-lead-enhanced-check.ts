import { useCallback, useEffect, useRef, useState } from "react";

import { useRealtimeSubscription } from "@/lib/realtime";

import { fetchLeadEnhancedCheck } from "../data/lead-enhanced-check-api";
import type { LeadEnhancedCheck } from "./enhanced-check";

/**
 * Loads whether the owner's rule requires the enhanced check of a lead
 * (`GET /leads/{id}/enhanced-check`) and keeps it fresh: again whenever
 * `version` changes (the wizard passes the lead and the payer declaration, so
 * a saved country, citizenship or "Кто платит" counts at once) and on
 * `lead.portal_updated` / `lead.updated` of the lead (the lead's cabinet, the
 * payer's own link). A failed load or an older server leaves `null`: the
 * wizard then decides from the black-list countries it shows.
 */
export function useLeadEnhancedCheck(leadId: string | null | undefined, version?: unknown) {
  const [check, setCheck] = useState<LeadEnhancedCheck | null>(null);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    if (!leadId) {
      setCheck(null);
      return null;
    }
    try {
      const next = await fetchLeadEnhancedCheck(leadId);
      if (request === requestRef.current) setCheck(next);
      return next;
    } catch {
      // Keep the last known answer: the wizard is not blocked by a failed load.
      return null;
    }
  }, [leadId]);

  useEffect(() => {
    setCheck(null);
  }, [leadId]);

  useEffect(() => {
    void reload();
  }, [reload, version]);

  useRealtimeSubscription(["lead.updated", "lead.portal_updated"], (event) => {
    if (leadId && event.entity_id === leadId) void reload();
  });

  return { check, reload };
}
