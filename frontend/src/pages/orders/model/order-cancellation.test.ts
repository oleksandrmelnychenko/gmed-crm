import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  isValidOrderCancelReason,
  normalizeOrderCancellationSummary,
  orderCancellationBalance,
  orderCancellationErrorMessage,
} from "./order-cancellation";

const tx = (...texts: [ru: string, de: string]) => texts[0];

describe("isValidOrderCancelReason", () => {
  it("requires 3 to 1000 characters of trimmed text", () => {
    expect(isValidOrderCancelReason("  ab ")).toBe(false);
    expect(isValidOrderCancelReason("Patient postponed")).toBe(true);
    expect(isValidOrderCancelReason("x".repeat(1001))).toBe(false);
  });
});

describe("normalizeOrderCancellationSummary", () => {
  it("reads the preview/cancellation payload of the server", () => {
    const summary = normalizeOrderCancellationSummary({
      reason: "Patient postponed",
      cancelled_services: [{ id: "l1", description: "Dolmetscher", quantity: "2", gross: "119" }],
      cancelled_appointment_ids: ["a1", "a2"],
      closed_quotes: [{ id: "q1", quote_number: "Q-1", previous_status: "sent" }],
      rejected_amendment_ids: ["m1"],
      settlement: {
        currency: "EUR",
        accrued_gross: "200",
        invoiced_gross: "0",
        paid_gross: "500",
        balance_gross: "-300",
        uninvoiced_gross: "200",
        lines: [{ description: "Organisation der Behandlung", status: "delivered", gross: "200" }],
      },
    });

    expect(summary.cancelled_services[0]).toEqual({
      id: "l1",
      description: "Dolmetscher",
      quantity: "2",
      gross: 119,
    });
    expect(summary.cancelled_appointment_ids).toEqual(["a1", "a2"]);
    expect(summary.closed_quotes[0].quote_number).toBe("Q-1");
    expect(summary.settlement?.balance_gross).toBe(-300);
    expect(summary.settlement?.lines[0].gross).toBe(200);
  });

  it("is render-safe for an empty payload", () => {
    const summary = normalizeOrderCancellationSummary(null);
    expect(summary.cancelled_services).toEqual([]);
    expect(summary.settlement).toBeNull();
    expect(summary.reason).toBeNull();
  });
});

describe("orderCancellationBalance", () => {
  it("tells whether to bill, refund or nothing is open", () => {
    expect(orderCancellationBalance({ balance_gross: 200 })).toEqual({ kind: "to_bill", amount: 200 });
    expect(orderCancellationBalance({ balance_gross: -300 })).toEqual({
      kind: "to_refund",
      amount: 300,
    });
    expect(orderCancellationBalance({ balance_gross: 0.004 })).toEqual({ kind: "settled", amount: 0 });
    expect(orderCancellationBalance(null)).toEqual({ kind: "settled", amount: 0 });
  });
});

describe("orderCancellationErrorMessage", () => {
  it("localizes the reason and terminal-status errors", () => {
    expect(
      orderCancellationErrorMessage(
        new ApiRequestError("A cancellation reason of 3 to 1000 characters is required", {
          status: 422,
        }),
        tx,
      ),
    ).toBe("Укажите причину отмены (3–1000 символов).");
    expect(
      orderCancellationErrorMessage(
        new ApiRequestError("Order status cannot change from completed to cancelled", {
          status: 422,
        }),
        tx,
      ),
    ).toBe("Заказ уже завершён или отменён — отменить его нельзя.");
  });
});
