import { moneyInputText, parseMoneyInput, roundCents, toCents } from "@/lib/money";

/** The prepayment terms of an order, named like the API and the order wizard draft. */
export type OrderPrepaymentTerms = {
  prepayment_required: boolean;
  prepayment_amount: string;
  /** ISO instant; the date input stores noon UTC of the chosen day. */
  prepayment_due_at: string | null;
};

export type OrderPrepaymentError = "amount_required" | "amount_exceeds_total";

export function blankOrderPrepaymentTerms(): OrderPrepaymentTerms {
  return { prepayment_required: false, prepayment_amount: "", prepayment_due_at: null };
}

function prepaymentAmount(value: string): number | null {
  const amount = parseMoneyInput(value);
  return toCents(amount) > 0 ? roundCents(amount) : null;
}

/**
 * Why the terms cannot be saved, with the wizards' rules: a required
 * prepayment needs a positive amount that the order total covers. A new order
 * has no total yet (`total` null); its quote must cover the amount later.
 */
export function orderPrepaymentError(
  terms: OrderPrepaymentTerms,
  total: number | null,
): OrderPrepaymentError | null {
  if (!terms.prepayment_required) return null;
  const amount = prepaymentAmount(terms.prepayment_amount);
  if (amount === null) return "amount_required";
  if (total !== null && toCents(amount) > toCents(total)) return "amount_exceeds_total";
  return null;
}

export function orderPrepaymentErrorMessage(error: OrderPrepaymentError, lang: "de" | "ru") {
  if (error === "amount_exceeds_total") {
    return lang === "de"
      ? "Die Vorauszahlung darf die Auftragssumme nicht übersteigen."
      : "Предоплата не может превышать сумму заказа.";
  }
  return lang === "de"
    ? "Bitte geben Sie die Vorauszahlung als positiven Betrag an."
    : "Укажите сумму предоплаты больше нуля.";
}

/** The stored prepayment of an order, as the form edits it. */
export function orderPrepaymentTerms(order: {
  prepayment_required?: boolean;
  prepayment_amount?: unknown;
  prepayment_due_at?: string | null;
}): OrderPrepaymentTerms {
  return {
    prepayment_required: Boolean(order.prepayment_required),
    // As staff type it: "1.500,00" form (owner 2026-11-11, German money format).
    prepayment_amount: order.prepayment_amount == null ? "" : moneyInputText(order.prepayment_amount),
    prepayment_due_at: order.prepayment_due_at ?? null,
  };
}

/** The prepayment fields of `POST /orders/{id}/commercial-basis`: an empty date clears the due date. */
export function orderPrepaymentUpdate(terms: OrderPrepaymentTerms) {
  const amount = prepaymentAmount(terms.prepayment_amount);
  if (!terms.prepayment_required || amount === null) return { prepayment_required: false };
  return {
    prepayment_required: true,
    prepayment_amount: amount.toFixed(2),
    prepayment_due_at: terms.prepayment_due_at ?? "",
  };
}

/** The prepayment fields of `POST /orders`; nothing when no prepayment is required. */
export function orderPrepaymentPayload(terms: OrderPrepaymentTerms) {
  const amount = prepaymentAmount(terms.prepayment_amount);
  if (!terms.prepayment_required || amount === null) return {};
  return {
    prepayment_required: true,
    prepayment_amount: amount.toFixed(2),
    ...(terms.prepayment_due_at ? { prepayment_due_at: terms.prepayment_due_at } : {}),
  };
}

/**
 * What the order total holds beyond the patient's invoices: «осталось получить»
 * counts issued invoices only, so 788 ordered and 550 billed read as settled
 * (QA 2026-11-01, X3 A-0011).
 */
export function orderNotYetBilledGross(orderTotal: unknown, billedGross: string | undefined) {
  const rest = Number(orderTotal ?? 0) - Number(billedGross ?? 0);
  return Number.isFinite(rest) && rest >= 0.005 ? Math.round(rest * 100) / 100 : 0;
}
