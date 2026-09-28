import { roundCents, toCents } from "@/lib/money";

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
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const amount = Number(normalized);
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
