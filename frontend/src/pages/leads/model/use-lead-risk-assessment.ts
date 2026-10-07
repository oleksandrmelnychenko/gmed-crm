import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRealtimeSubscription } from "@/lib/realtime";

import {
  confirmLeadRiskDecision,
  fetchLeadRiskAssessment,
  postLeadRiskDecision,
  restartLeadRiskAssessment,
  withdrawLeadRiskDecision,
} from "../data/lead-risk-api";
import type { LeadRiskAssessment, RiskDecisionKind } from "./lead-risk-assessment";

/** The staff actions of the risk panel; each reloads the assessment afterwards. */
export type LeadRiskController = {
  decide: (input: { decision: RiskDecisionKind; reason: string; blocks?: string[] }) => Promise<void>;
  confirm: (decisionId: string, reason: string) => Promise<void>;
  withdraw: (decisionId: string, reason: string) => Promise<void>;
  restart: () => Promise<void>;
  reload: () => Promise<LeadRiskAssessment | null>;
};

/**
 * Loads the lead's risk assessment (`GET /leads/{id}/risk-assessment`) and
 * keeps it fresh: again whenever `version` changes (the wizard passes the
 * lead and the payer declaration) and on `lead.updated` /
 * `lead.portal_updated` of the lead (the cabinet, the payer link, a
 * sanctions decision). A failed load keeps the last answer; an older server
 * leaves `null` and the panel is not shown.
 */
export function useLeadRiskAssessment(leadId: string | null | undefined, version?: unknown) {
  const [assessment, setAssessment] = useState<LeadRiskAssessment | null>(null);
  const [loaded, setLoaded] = useState(false);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    if (!leadId) {
      setAssessment(null);
      return null;
    }
    try {
      const next = await fetchLeadRiskAssessment(leadId);
      if (request === requestRef.current) {
        setAssessment(next);
        setLoaded(true);
      }
      return next;
    } catch {
      if (request === requestRef.current) setLoaded(true);
      return null;
    }
  }, [leadId]);

  useEffect(() => {
    setAssessment(null);
    setLoaded(false);
  }, [leadId]);

  useEffect(() => {
    void reload();
  }, [reload, version]);

  useRealtimeSubscription(["lead.updated", "lead.portal_updated"], (event) => {
    if (leadId && event.entity_id === leadId) void reload();
  });

  const controller = useMemo<LeadRiskController>(
    () => ({
      reload,
      decide: async (input) => {
        if (!leadId) return;
        await postLeadRiskDecision(leadId, input);
        await reload();
      },
      confirm: async (decisionId, reason) => {
        if (!leadId) return;
        await confirmLeadRiskDecision(leadId, decisionId, reason);
        await reload();
      },
      withdraw: async (decisionId, reason) => {
        if (!leadId) return;
        await withdrawLeadRiskDecision(leadId, decisionId, reason);
        await reload();
      },
      restart: async () => {
        if (!leadId) return;
        await restartLeadRiskAssessment(leadId);
        await reload();
      },
    }),
    [leadId, reload],
  );

  return { assessment, loaded, controller };
}
