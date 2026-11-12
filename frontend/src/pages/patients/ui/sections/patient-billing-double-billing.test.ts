import { describe, expect, it } from "vitest";

import {
  doubleBillingWarnings,
  proposedOrderForExpense,
  rebilledOrderExpenses,
  type DoubleBillingExpense,
  type DoubleBillingOrder,
} from "./patient-billing-double-billing";

const orders: Array<DoubleBillingOrder & { currency: string }> = [
  {
    id: "order-1",
    order_number: "ORD-1",
    currency: "EUR",
    services: [
      { id: "line-1", status: "planned", is_cost_passthrough: false, name: "Begleitung" },
      { id: "line-transit", status: "planned", is_cost_passthrough: true, name: "Durchlaufposten Transfer" },
    ],
  },
  {
    id: "order-2",
    order_number: "ORD-2",
    currency: "EUR",
    services: [{ id: "line-cancelled", status: "cancelled", is_cost_passthrough: true, name: "Alt" }],
  },
];

function receipt(overrides: Partial<DoubleBillingExpense & { currency: string }> = {}) {
  return {
    id: "expense-1",
    external_invoice_number: "CON-1",
    proposed_order_id: "order-1",
    source_order_id: null,
    allocated_receivable_gross: "0.00",
    order_service_billed: false,
    currency: "EUR",
    ...overrides,
  };
}

describe("patient billing double billing (owner 2026-11-12, QA C-1/C-2)", () => {
  it("proposes the order of the receipt's Concierge service in the receipt's currency", () => {
    expect(proposedOrderForExpense(receipt(), orders)?.id).toBe("order-1");
    expect(proposedOrderForExpense(receipt({ proposed_order_id: null, source_order_id: "order-2" }), orders)?.id).toBe("order-2");
    expect(proposedOrderForExpense(receipt({ currency: "USD" }), orders)).toBeNull();
    expect(proposedOrderForExpense(receipt({ proposed_order_id: null }), orders)).toBeNull();
  });

  it("warns when a ticked receipt belongs to an order with a transit line", () => {
    const warnings = doubleBillingWarnings({
      orders,
      expenses: [receipt()],
      selectedExpenseIds: ["expense-1"],
      orderId: "",
      selectedQuoteLines: [],
    });
    expect(warnings.transitForSelectedExpenses.map((item) => item.names)).toEqual([["Durchlaufposten Transfer"]]);
    expect(warnings.rebilledForTransitLines).toBeNull();
  });

  it("ignores cancelled transit lines and unticked receipts", () => {
    expect(doubleBillingWarnings({
      orders,
      expenses: [receipt({ proposed_order_id: "order-2" }), receipt({ id: "expense-2" })],
      selectedExpenseIds: ["expense-1"],
      orderId: "",
      selectedQuoteLines: [],
    }).transitForSelectedExpenses).toEqual([]);
  });

  it("warns when a transit quote line is billed while receipts of the order are re-billed", () => {
    const expenses = [
      receipt({ allocated_receivable_gross: "101.75" }),
      receipt({ id: "expense-2", allocated_receivable_gross: "0.00" }),
      // The cost of the transit line itself is never re-billed.
      receipt({ id: "expense-3", allocated_receivable_gross: "50.00", order_service_billed: true }),
      receipt({ id: "expense-4", proposed_order_id: "order-2", allocated_receivable_gross: "20.00" }),
    ];
    expect(rebilledOrderExpenses("order-1", expenses, []).map((item) => item.id)).toEqual(["expense-1"]);
    expect(rebilledOrderExpenses("order-1", expenses, ["expense-2"]).map((item) => item.id)).toEqual(["expense-1", "expense-2"]);
    const warnings = doubleBillingWarnings({
      orders,
      expenses,
      selectedExpenseIds: [],
      orderId: "order-1",
      selectedQuoteLines: [
        { description: "Begleitung", is_cost_passthrough: false },
        { description: "Durchlaufposten Transfer", is_cost_passthrough: true },
      ],
    });
    expect(warnings.rebilledForTransitLines?.lines).toEqual(["Durchlaufposten Transfer"]);
    expect(warnings.rebilledForTransitLines?.expenses.map((item) => item.id)).toEqual(["expense-1"]);
    expect(doubleBillingWarnings({
      orders,
      expenses,
      selectedExpenseIds: [],
      orderId: "order-1",
      selectedQuoteLines: [{ description: "Begleitung", is_cost_passthrough: false }],
    }).rebilledForTransitLines).toBeNull();
  });
});
