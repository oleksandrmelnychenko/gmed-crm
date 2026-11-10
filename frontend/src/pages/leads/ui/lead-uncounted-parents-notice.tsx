import { useCallback, useEffect, useState } from "react";

import { acknowledgeUncountedParent, fetchLeadRiskAssessment } from "../data/lead-risk-api";
import { normalizeLeadRiskAssessment, type UncountedParentNotice } from "../model/lead-risk-assessment";
import type { Tx } from "../model/lead-payer";
import { UncountedParentRow } from "./lead-risk-assessment-panel";

/**
 * The parents of a minor who neither pay nor receive the invoices and whose
 * country is on a risk list, in the lead's card (owner 2026-11-10): Sales
 * works the lead without the wizard, so the confirmation «Принято к
 * сведению» stands here too. Nothing shows while there is no such parent.
 */
export function LeadUncountedParentsNotice({ leadId, tx, lang }: { leadId: string; tx: Tx; lang: string }) {
  const [parents, setParents] = useState<UncountedParentNotice[]>([]);
  const load = useCallback(async () => {
    try {
      const assessment = await fetchLeadRiskAssessment(leadId);
      setParents(assessment?.uncounted_parents ?? []);
    } catch {
      // A role without access to the assessment sees nothing here.
      setParents([]);
    }
  }, [leadId]);
  useEffect(() => {
    setParents([]);
    void load();
  }, [load]);
  if (parents.length === 0) return null;
  return (
    <div className="mt-3 space-y-2" data-testid="lead-detail-uncounted-parents">
      {parents.map((parent) => (
        <UncountedParentRow
          key={parent.representative_id}
          parent={parent}
          lang={lang}
          tx={tx}
          disabled={false}
          onAcknowledge={async () => {
            const next = await acknowledgeUncountedParent(leadId, parent.representative_id);
            const assessment = normalizeLeadRiskAssessment(next);
            if (assessment) setParents(assessment.uncounted_parents);
            else await load();
          }}
        />
      ))}
    </div>
  );
}
