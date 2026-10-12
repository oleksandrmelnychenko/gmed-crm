import { roundCents, toCents } from "@/lib/money";

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
  /** False when the target is addressed to another recipient than the source. */
  same_recipient?: boolean;
};

/**
 * What the server names when credit would move to another recipient's invoice
 * (`credit_transfer_recipient_mismatch`): both invoices, both recipients and
 * the amount, so billing confirms a move between two debtors knowingly.
 */
export type CreditTransferRecipientMismatch = {
  sourceInvoiceNumber: string;
  sourceRecipientName: string;
  targetInvoiceNumber: string;
  targetRecipientName: string;
  amountGross: string;
  currency: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The mismatch details of a 409 body, null for any other answer. */
export function creditTransferRecipientMismatch(body: unknown): CreditTransferRecipientMismatch | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.error !== "credit_transfer_recipient_mismatch") return null;
  return {
    sourceInvoiceNumber: text(record.source_invoice_number),
    sourceRecipientName: text(record.source_recipient_name),
    targetInvoiceNumber: text(record.target_invoice_number),
    targetRecipientName: text(record.target_recipient_name),
    amountGross: text(record.amount_gross),
    currency: text(record.currency) || "EUR",
  };
}

/** The question of the confirmation dialog, in the UI language. */
export function creditTransferMismatchQuestion(
  mismatch: CreditTransferRecipientMismatch,
  lang: string,
  money: (value: unknown, currency: string) => string,
): string {
  const amountText = money(mismatch.amountGross, mismatch.currency);
  const unknown = lang === "de" ? "unbekannt" : "не указан";
  const source = mismatch.sourceRecipientName || unknown;
  const target = mismatch.targetRecipientName || unknown;
  return lang === "de"
    ? `${amountText} Guthaben von ${source} (Rechnung ${mismatch.sourceInvoiceNumber || "—"}) werden auf die Rechnung ${mismatch.targetInvoiceNumber || "—"} von ${target} umgebucht. Das Geld eines Zahlers begleicht damit die Rechnung eines anderen Empfängers.`
    : `Переплата ${amountText} получателя «${source}» (счёт ${mismatch.sourceInvoiceNumber || "—"}) будет зачтена в счёт ${mismatch.targetInvoiceNumber || "—"} получателя «${target}». Деньги одного плательщика закроют счёт другого получателя.`;
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
  const text = String(value ?? "").trim();
  if (text === "") return Number.NaN;
  const numeric = Number(text.replace(",", "."));
  return Number.isFinite(numeric) ? numeric : Number.NaN;
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
  return Number.isFinite(available) && available > 0 ? roundCents(available).toFixed(2) : "";
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
