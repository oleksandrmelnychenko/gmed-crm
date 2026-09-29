import { AlertTriangle, ReceiptText } from "lucide-react";

import {
  type BillingReversalPreview,
  billingReversalBlockedMessage,
  billingReversalEffect,
  billingReversalFinanceHint,
  billingReversalNeedsFinanceRole,
} from "@/lib/billing-reversal";
import { formatMoneyAmount } from "@/lib/money";

type Bilingual = (ru: string, de: string) => string;

/**
 * What cancelling a billed service does: nothing blocks it and no credit note
 * is needed, a credit note with its amount is issued, or it is blocked (draft
 * invoice, missing finance role).
 */
export function BillingReversalNotice({
  preview,
  canIssueCreditNote,
  tx,
}: {
  preview: BillingReversalPreview;
  canIssueCreditNote: boolean;
  tx: Bilingual;
}) {
  const blocked = billingReversalBlockedMessage(preview, tx);
  const needsFinance = !blocked && billingReversalNeedsFinanceRole(preview, canIssueCreditNote);
  const tone = blocked || needsFinance
    ? "border-destructive/30 bg-destructive/5 text-destructive"
    : preview.requires_credit_note
      ? "border-amber-500/40 bg-amber-500/10 text-foreground"
      : "border-border bg-muted/30 text-foreground";
  return (
    <div className={`grid gap-2 rounded-lg border p-3 text-sm ${tone}`} role="status">
      <p className="flex items-start gap-2">
        {preview.requires_credit_note ? (
          <ReceiptText className="mt-0.5 size-4 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        )}
        <span>{blocked ?? billingReversalEffect(preview, tx)}</span>
      </p>
      {!blocked && preview.requires_credit_note ? (
        <ul className="grid gap-1 pl-6 text-xs text-muted-foreground">
          {preview.credit_notes.map((credit) => (
            <li key={credit.invoice_id}>
              {tx("Счёт", "Rechnung")} {credit.invoice_number ?? "—"}:{" "}
              {formatMoneyAmount(credit.amount_gross, credit.currency)}
            </li>
          ))}
        </ul>
      ) : null}
      {needsFinance ? <p className="pl-6">{billingReversalFinanceHint(tx)}</p> : null}
    </div>
  );
}
