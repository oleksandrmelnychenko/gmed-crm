/**
 * Concierge and other supplier costs are billed canonically by re-billing
 * the posted receipt; a transit line (pass-through order position) is only
 * for a price known in advance (owner decision 2026-11-12, QA C-2). Both are
 * not linked, so the patient billing tab warns when the same order bills
 * costs both ways. A receipt attributed to the transit line itself is its
 * cost (`order_service_billed`) and is never re-billed, so it does not warn.
 */

export type DoubleBillingOrder = {
  id: string;
  order_number: string;
  services: Array<{ id: string; status: string; is_cost_passthrough?: boolean; name?: string | null }>;
};

export type DoubleBillingExpense = {
  id: string;
  external_invoice_number: string;
  /** The order of the cost: its own, else the order of its Concierge service. */
  proposed_order_id?: string | null;
  source_order_id: string | null;
  allocated_receivable_gross: string;
  order_service_billed?: boolean;
};

export type DoubleBillingQuoteLine = {
  description: string;
  is_cost_passthrough: boolean;
};

export function expenseOrderId(expense: DoubleBillingExpense) {
  return expense.proposed_order_id ?? expense.source_order_id ?? null;
}

/** Transit lines of an order that are not cancelled. */
export function orderTransitLines(order: DoubleBillingOrder | null | undefined) {
  return (order?.services ?? []).filter((service) => service.is_cost_passthrough && service.status !== "cancelled");
}

/**
 * Re-billed receipts of an order that a transit line may bill a second time:
 * receipts already billed to the patient, or ticked for this draft.
 */
export function rebilledOrderExpenses<E extends DoubleBillingExpense>(
  orderId: string,
  expenses: E[],
  selectedExpenseIds: string[],
) {
  if (!orderId) return [];
  return expenses.filter((expense) => (
    !expense.order_service_billed
    && expenseOrderId(expense) === orderId
    && (Number(expense.allocated_receivable_gross || 0) > 0 || selectedExpenseIds.includes(expense.id))
  ));
}

/**
 * Warning inputs for the draft being built: transit lines of the order of
 * a ticked receipt, and re-billed receipts of the order when a transit line
 * of the quote is ticked.
 */
export function doubleBillingWarnings<O extends DoubleBillingOrder, E extends DoubleBillingExpense>(input: {
  orders: O[];
  expenses: E[];
  selectedExpenseIds: string[];
  orderId: string;
  selectedQuoteLines: DoubleBillingQuoteLine[];
}) {
  const transitByOrder = new Map<string, { order: O; names: string[] }>();
  for (const expense of input.expenses) {
    if (!input.selectedExpenseIds.includes(expense.id)) continue;
    const orderId = expenseOrderId(expense) ?? input.orderId;
    const order = input.orders.find((candidate) => candidate.id === orderId);
    const transit = orderTransitLines(order);
    if (order && transit.length && !transitByOrder.has(order.id)) {
      transitByOrder.set(order.id, {
        order,
        names: transit.map((line) => line.name?.trim() || order.order_number),
      });
    }
  }
  const transitQuoteLines = input.selectedQuoteLines.filter((line) => line.is_cost_passthrough);
  const rebilled = transitQuoteLines.length
    ? rebilledOrderExpenses(input.orderId, input.expenses, input.selectedExpenseIds)
    : [];
  return {
    transitForSelectedExpenses: [...transitByOrder.values()],
    rebilledForTransitLines: rebilled.length
      ? { lines: transitQuoteLines.map((line) => line.description), expenses: rebilled }
      : null,
  };
}

/**
 * The order to propose when a receipt is ticked while no order is chosen:
 * the receipt's own order or the order of its Concierge service (QA
 * 2026-11-12 C-1), if it is listed and uses the receipt's currency.
 */
export function proposedOrderForExpense<T extends { id: string; currency: string }>(
  expense: DoubleBillingExpense & { currency: string },
  orders: T[],
) {
  const orderId = expenseOrderId(expense);
  if (!orderId) return null;
  return orders.find((order) => order.id === orderId && order.currency === expense.currency) ?? null;
}

/** A receipt of the billing workspace with the patient invoice that re-bills it. */
export type RebilledReceipt = DoubleBillingExpense & {
  latest_patient_invoice_number?: string | null;
};

/** How re-billed receipts are named in a warning: their patient invoice, else their number. */
export function rebilledReceiptLabels(expenses: RebilledReceipt[]) {
  return [...new Set(expenses.map((expense) => (
    expense.latest_patient_invoice_number?.trim() || expense.external_invoice_number
  )).filter(Boolean))];
}

/**
 * Warning where a transit line is added to an order (order page) or billed
 * (invoice dialog) while receipts of the same order are already re-billed to
 * the patient. Only a warning: staff may still save (owner 2026-11-12, C-2).
 */
export function transitLineRebilledWarning(
  lang: string,
  lineNames: string[],
  expenses: RebilledReceipt[],
) {
  const receipts = rebilledReceiptLabels(expenses);
  if (!receipts.length) return null;
  const lines = lineNames.map((name) => name.trim()).filter(Boolean).join(", ");
  if (lang === "de") {
    return `Belege dieses Auftrags wurden dem Patienten bereits weiterberechnet (${receipts.join(", ")}). `
      + `Concierge-Kosten werden über die Belege berechnet; eine Durchlaufposition${lines ? ` (${lines})` : ""} gilt nur für einen vorab bekannten Preis. `
      + "Prüfen, dass der Patient dieselben Kosten nicht doppelt zahlt.";
  }
  return `Расходы этого заказа уже перевыставлены пациенту по чекам (${receipts.join(", ")}). `
    + `Расходы Concierge выставляются через перевыставление чеков; транзитная позиция${lines ? ` (${lines})` : ""} — только для заранее известной цены. `
    + "Проверьте, что пациент не оплатит одни и те же расходы дважды.";
}
