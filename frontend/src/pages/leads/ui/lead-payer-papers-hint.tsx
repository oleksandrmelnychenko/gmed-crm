import { useEffect, useState } from "react";

import { Banner } from "@/components/ui-shell";

import { fetchLeadPayerDeclaration } from "../data/lead-payer-api";
import { payerPapersPredateText } from "../model/lead-payer-paper";

/**
 * The hint of the payer block where the compliance is decided: a paper counted
 * for the payer dates from before the person named now. It blocks nothing
 * (owner decision 2026-11-01). A failed read shows no hint: the payer block
 * reports its own errors.
 */
export function LeadPayerPapersHint({ leadId, tx }: { leadId: string; tx: (ru: string, de: string) => string }) {
  const [shown, setShown] = useState<{ leadId: string; predate: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    fetchLeadPayerDeclaration(leadId)
      .then((payer) => {
        if (active) setShown({ leadId, predate: payer?.status?.identification?.papers_predate_payer === true });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [leadId]);

  if (shown?.leadId !== leadId || !shown.predate) return null;
  return <Banner tone="warning" withIcon data-testid="lead-compliance-papers-predate">{payerPapersPredateText(tx)}</Banner>;
}
