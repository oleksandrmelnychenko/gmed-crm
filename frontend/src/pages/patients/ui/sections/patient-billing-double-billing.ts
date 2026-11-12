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
