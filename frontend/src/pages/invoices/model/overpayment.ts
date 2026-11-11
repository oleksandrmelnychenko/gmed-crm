import { moneyInputText, parseMoneyInput, roundCents, toCents } from "@/lib/money";

/**
 * Overpayments and credit transfers. A receipt above the open balance is
 * recorded in full; the excess becomes the patient's credit balance on the
 * invoice, which billing refunds or moves to another open invoice.
 */

/** A credit balance moved between two invoices of the patient. */
export type InvoiceCreditTransfer = {
  id: string;
  direction: "in" | "out";
  source_invoice_id: string;
  source_invoice_number: string;
  target_invoice_id: string;
  target_invoice_number: string;
  amount_gross: string;
  currency: string;
  transferred_on: string;
  note: string | null;
  created_by_name: string;
  created_at: string;
  is_reversed: boolean;
};

/** Open invoice of the same patient a credit balance can settle. */
export type InvoiceCreditTransferTarget = {
  invoice_id: string;
  invoice_number: string;
  invoice_type: string;
  order_number: string | null;
  balance_due: string;
  /** Recipient of the target invoice (QA D3-04). */
  recipient_name?: string | null;
  /** False when the target is addressed to another recipient than the source (never offered since 2026-11-12). */
  same_recipient?: boolean;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The invoices a credit may go to: the same invoice recipient person only.
 * Credit never moves to another person's invoice, not even with a
 * confirmation (owner decision 2026-11-12, QA L12); the server leaves such
 * invoices out and refuses them with `credit_transfer_other_person`.
 */
export function creditTransferTargets(targets: readonly InvoiceCreditTransferTarget[] | undefined): InvoiceCreditTransferTarget[] {
  return (targets ?? []).filter((target) => target.same_recipient !== false);
}

/** Option text of a target invoice, with its recipient. */
export function creditTransferTargetLabel(
  target: InvoiceCreditTransferTarget,
  template: string,
  lang: string,
  money: (value: unknown) => string,
): string {
  const base = template
    .replace("{number}", target.invoice_number)
    .replace("{order}", target.order_number ?? "—")
    .replace("{amount}", money(target.balance_due));
  const recipient = text(target.recipient_name);
  if (!recipient) return base;
  const other = target.same_recipient === false
    ? lang === "de" ? " (anderer Empfänger)" : " (другой получатель)"
    : "";
  return `${base} · ${lang === "de" ? "Empfänger" : "получатель"}: ${recipient}${other}`;
}

/** Receipts moved from another invoice's credit, not money from outside. */
export const CREDIT_TRANSFER_METHOD = "credit_transfer";

function amount(value: unknown): number {
  return parseMoneyInput(String(value ?? ""));
}

/** Part of a receipt above the open balance (0 when it fits). */
export function paymentOverpayment(receipt: unknown, balanceDue: unknown): number {
  const paid = amount(receipt);
  const open = amount(balanceDue);
  if (!Number.isFinite(paid) || paid <= 0) return 0;
  const excess = roundCents(paid - (Number.isFinite(open) ? Math.max(open, 0) : 0));
  return toCents(excess) > 0 ? excess : 0;
}

/** Proposed transfer: the credit, at most what the target still asks for. */
export function creditTransferDefaultAmount(credit: unknown, targetBalance: unknown): string {
  const available = Math.min(amount(credit), amount(targetBalance));
  return Number.isFinite(available) && available > 0 ? moneyInputText(roundCents(available)) : "";
}

export type CreditTransferProblem = "invalid_amount" | "exceeds_credit" | "exceeds_target" | "no_target";

export function creditTransferProblem(
  transfer: unknown,
  credit: unknown,
  targetBalance: unknown,
): CreditTransferProblem | null {
  if (!Number.isFinite(amount(targetBalance))) return "no_target";
  const value = amount(transfer);
  if (!Number.isFinite(value) || toCents(value) <= 0) return "invalid_amount";
  if (toCents(value) > toCents(amount(credit))) return "exceeds_credit";
  if (toCents(value) > toCents(amount(targetBalance))) return "exceeds_target";
  return null;
}
