import { describe, expect, it } from "vitest";

import {
  doubleBillingWarnings,
  proposedOrderForExpense,
  rebilledOrderExpenses,
  rebilledReceiptLabels,
  transitLineRebilledWarning,
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

describe("transit line warning on the order page and in the invoice dialog (C-2)", () => {
  const rebilled = [
    { ...receipt({ allocated_receivable_gross: "101.75" }), latest_patient_invoice_number: "RE-2026-0007" },
    { ...receipt({ id: "expense-2", external_invoice_number: "CON-2", allocated_receivable_gross: "20.00" }), latest_patient_invoice_number: "RE-2026-0007" },
    { ...receipt({ id: "expense-3", external_invoice_number: "CON-3", allocated_receivable_gross: "5.00" }), latest_patient_invoice_number: null },
  ];

  it("names each patient invoice once, else the receipt number", () => {
    expect(rebilledReceiptLabels(rebilled)).toEqual(["RE-2026-0007", "CON-3"]);
  });

  it("warns only when receipts of the order are already re-billed", () => {
    expect(transitLineRebilledWarning("ru", ["Трансфер"], [])).toBeNull();
    const ru = transitLineRebilledWarning("ru", ["Трансфер", " "], rebilled);
    expect(ru).toContain("RE-2026-0007, CON-3");
    expect(ru).toContain("транзитная позиция (Трансфер)");
    const de = transitLineRebilledWarning("de", [""], rebilled);
    expect(de).toContain("bereits weiterberechnet (RE-2026-0007, CON-3)");
    expect(de).toContain("eine Durchlaufposition gilt nur");
  });

  it("takes the order's re-billed receipts as the order page and the dialog read them", () => {
    const workspaceExpenses = [
      ...rebilled,
      receipt({ id: "expense-open", allocated_receivable_gross: "0.00" }),
      receipt({ id: "expense-line", allocated_receivable_gross: "50.00", order_service_billed: true }),
      receipt({ id: "expense-other", proposed_order_id: "order-2", allocated_receivable_gross: "9.00" }),
    ];
    expect(rebilledOrderExpenses("order-1", workspaceExpenses, []).map((item) => item.id))
      .toEqual(["expense-1", "expense-2", "expense-3"]);
  });
});
