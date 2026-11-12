import { useEffect, useState } from "react";

import { formatMoneyAmount, parseMoneyInput } from "@/lib/money";
import type { Lang } from "@/lib/i18n";

import { getConciergeExpenses } from "./expense-receipt-api";
import { actualCostMismatch, postedReceiptTotals } from "./expense-receipt-model";

const copy = {
  de: {
    posted: (count: number, net: string, gross: string) =>
      `Verbuchte Belege (${count}): ${net} netto · ${gross} brutto`,
    mismatch: "Die tatsächlichen Kosten weichen von den verbuchten Belegen ab. Bitte prüfen.",
  },
  ru: {
    posted: (count: number, net: string, gross: string) =>
      `Проведённые чеки (${count}): ${net} нетто · ${gross} брутто`,
    mismatch: "Фактическая стоимость не совпадает с проведёнными чеками. Проверьте сумму.",
  },
} as const;

/**
 * The receipts Billing posted for a Concierge service, next to the freely
 * typed «actual cost»; a mismatch warns but never blocks saving (QA
 * 2026-11-12 C-9). Shows nothing while loading, without posted receipts, or
 * when the role may not read the receipts.
 */
export function PostedReceiptsHint({
  serviceId,
  actualCost,
  currency,
  lang,
  enabled = true,
}: {
  serviceId: string;
  actualCost: string;
  currency: string;
  lang: Lang;
  /** False for a role the server does not let read the receipts: no call, no 403. */
  enabled?: boolean;
}) {
  const [totals, setTotals] = useState<ReturnType<typeof postedReceiptTotals> | null>(null);

  useEffect(() => {
    let active = true;
    setTotals(null);
    if (!enabled) return undefined;
    getConciergeExpenses(serviceId)
      .then((response) => {
        if (active) setTotals(postedReceiptTotals(response.items));
      })
      .catch(() => {
        if (active) setTotals(null);
      });
    return () => {
      active = false;
    };
  }, [serviceId, enabled]);

  if (!totals?.count) return null;
  const labels = copy[lang];
  const mismatch = actualCost.trim() !== "" && actualCostMismatch(parseMoneyInput(actualCost), totals);
  return (
    <span className="block space-y-0.5 text-[11px]" data-testid="concierge-service-posted-receipts">
      <span className="block text-muted-foreground">
        {labels.posted(
          totals.count,
          formatMoneyAmount(totals.netCents / 100, currency),
          formatMoneyAmount(totals.grossCents / 100, currency),
        )}
      </span>
      {mismatch ? <span className="block text-amber-700 dark:text-amber-300">{labels.mismatch}</span> : null}
    </span>
  );
}
