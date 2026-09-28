import { describe, expect, it } from "vitest";

import {
  blankOrderPrepaymentTerms,
  orderPrepaymentError,
  orderPrepaymentPayload,
} from "./order-prepayment";

const required = (amount: string, dueAt: string | null = null) => ({
  prepayment_required: true,
  prepayment_amount: amount,
  prepayment_due_at: dueAt,
});

describe("order prepayment terms", () => {
  it("sends nothing when no prepayment is required", () => {
    expect(orderPrepaymentError(blankOrderPrepaymentTerms(), null)).toBeNull();
    expect(orderPrepaymentPayload(blankOrderPrepaymentTerms())).toEqual({});
    expect(
      orderPrepaymentPayload({ ...required("150"), prepayment_required: false }),
    ).toEqual({});
  });

  it("requires a positive amount", () => {
    for (const amount of ["", "0", "0.004", "-5", "abc"]) {
      expect(orderPrepaymentError(required(amount), null)).toBe("amount_required");
    }
    expect(orderPrepaymentError(required("150"), null)).toBeNull();
  });

  it("refuses an amount above a known order total", () => {
    expect(orderPrepaymentError(required("119.01"), 119)).toBe("amount_exceeds_total");
    expect(orderPrepaymentError(required("119,00"), 119)).toBeNull();
    // A new order has no total yet; its quote has to cover the amount.
    expect(orderPrepaymentError(required("5000"), null)).toBeNull();
  });

  it("sends the amount in cents and the due date when set", () => {
    expect(orderPrepaymentPayload(required("150,005", "2026-10-15T12:00:00Z"))).toEqual({
      prepayment_required: true,
      prepayment_amount: "150.01",
      prepayment_due_at: "2026-10-15T12:00:00Z",
    });
    expect(orderPrepaymentPayload(required("80"))).toEqual({
      prepayment_required: true,
      prepayment_amount: "80.00",
    });
  });
});
