import { toCents } from "@/lib/money";

import type { InvoiceItem, InvoicePaymentTransaction } from "./types";

/**
 * Amount rules of the invoice workspace (QA 2026-10-11): the list columns
 * add up, a payment correction knows the real limit, and the credit-note
 * form says what a credit note releases.
 */

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cents(value: number): number {
  return toCents(value) / 100;
}

/**
 * The list row: "Итого" is the total after credit notes, "Оплачено" counts
 * cash and the advance money credited into the invoice, "Баланс" is what is
 * still open — so Итого − Оплачено = Баланс for every row that is not
 * overpaid (QA D-33).
 */
export type InvoiceListAmounts = {
  /** Total after credit notes. */
  total: number;
  /** Total as issued, before credit notes. */
  issuedTotal: number;
  credited: number;
  /** Cash plus credited advance money. */
  settled: number;
  cash: number;
  prepayment: number;
  balance: number;
  /** Money beyond the corrected total (patient credit). */
  credit: number;
};

export function invoiceListAmounts(
  row: Pick<
    InvoiceItem,
    | "total_gross"
    | "credited_amount"
    | "adjusted_total_gross"
    | "paid_amount"
    | "prepayment_applied_amount"
    | "balance_due"
    | "credit_balance"
  >,
): InvoiceListAmounts {
  const issuedTotal = amount(row.total_gross);
  const credited = amount(row.credited_amount);
  const total =
    row.adjusted_total_gross == null
      ? cents(Math.max(issuedTotal - credited, 0))
      : amount(row.adjusted_total_gross);
  const cash = amount(row.paid_amount);
  const prepayment = amount(row.prepayment_applied_amount);
  return {
    total,
    issuedTotal,
    credited,
    settled: cents(cash + prepayment),
    cash,
    prepayment,
    balance: amount(row.balance_due),
    credit: amount(row.credit_balance),
  };
}

/**
 * What the invoice asks for from one receipt when it is corrected: the
 * corrected total minus credited advance money and the other cash already
 * received. Above it the corrected receipt overpays and the excess becomes
 * the patient's credit (QA D-07: the open balance is clamped at 0 on an
 * overpaid invoice and was the wrong limit).
 */
export function paymentCorrectionLimit(
  invoice: Pick<
    InvoiceItem,
    "total_gross" | "credited_amount" | "adjusted_total_gross" | "paid_amount" | "prepayment_applied_amount"
  >,
  payment: Pick<InvoicePaymentTransaction, "amount_gross">,
): number {
  const { total, cash, prepayment } = invoiceListAmounts({
    ...invoice,
    balance_due: 0,
    credit_balance: 0,
  });
  const otherCash = cash - amount(payment.amount_gross);
  return cents(Math.max(total - prepayment - otherCash, 0));
}

/**
 * What a credit note of `creditGross` releases on the invoice: advance money
 * credited into it beyond its corrected total (it becomes the patient's
 * refundable credit on the advance) and re-billed supplier costs beyond it
 * (unbilled again). Same rule as the server (QA D-63, D-64).
 */
export function creditNoteReleases(
  invoice: Pick<
    InvoiceItem,
    | "total_gross"
    | "credited_amount"
    | "adjusted_total_gross"
    | "prepayment_applied_amount"
    | "supplier_cost_allocated_gross"
  >,
  creditGross: number,
): { prepayment: number; supplierCost: number } {
  if (!Number.isFinite(creditGross) || creditGross <= 0) {
    return { prepayment: 0, supplierCost: 0 };
  }
  const { total, prepayment } = invoiceListAmounts({
    ...invoice,
    paid_amount: 0,
    balance_due: 0,
    credit_balance: 0,
  });
  const remaining = Math.max(total - creditGross, 0);
  const supplierCost = amount(invoice.supplier_cost_allocated_gross);
  return {
    prepayment: cents(Math.max(prepayment - remaining, 0)),
    supplierCost: cents(Math.max(supplierCost - remaining, 0)),
  };
}
