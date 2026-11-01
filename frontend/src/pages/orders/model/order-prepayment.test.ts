import { describe, expect, it } from "vitest";

import {
  blankOrderPrepaymentTerms,
  orderNotYetBilledGross,
  orderPrepaymentError,
  orderPrepaymentPayload,
  orderPrepaymentTerms,
  orderPrepaymentUpdate,
} from "./order-prepayment";

describe("orderNotYetBilledGross", () => {
  it("is what the order total holds beyond the invoices, never negative", () => {
    expect(orderNotYetBilledGross("788", "550")).toBe(238);
    expect(orderNotYetBilledGross(714, "827.05")).toBe(0);
    expect(orderNotYetBilledGross("550", "550.00")).toBe(0);
    expect(orderNotYetBilledGross(undefined, undefined)).toBe(0);
  });
});

const required = (amount: string, dueAt: string | null = null) => ({
  prepayment_required: true,
  prepayment_amount: amount,
  prepayment_due_at: dueAt,
});

describe("order prepayment terms", () => {
  it("reads the stored terms and writes them back for the order workspace", () => {
    expect(orderPrepaymentTerms({})).toEqual(blankOrderPrepaymentTerms());
    const stored = orderPrepaymentTerms({
      prepayment_required: true,
      prepayment_amount: "500",
      prepayment_due_at: "2026-11-05T12:00:00Z",
    });
    expect(orderPrepaymentUpdate(stored)).toEqual({
      prepayment_required: true,
      prepayment_amount: "500.00",
      prepayment_due_at: "2026-11-05T12:00:00Z",
    });
    // An empty date clears the deadline; no prepayment clears the amount.
    expect(orderPrepaymentUpdate({ ...stored, prepayment_due_at: null })).toMatchObject({
      prepayment_due_at: "",
    });
    expect(orderPrepaymentUpdate({ ...stored, prepayment_required: false })).toEqual({
      prepayment_required: false,
    });
  });

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

  it("reads a typed «1.500» as thousands (QA 2026-10-31)", () => {
    expect(orderPrepaymentPayload(required("1.500"))).toEqual({
      prepayment_required: true,
      prepayment_amount: "1500.00",
    });
    expect(orderPrepaymentError(required("1.500"), 1000)).toBe("amount_exceeds_total");
    expect(orderPrepaymentError(required("1,500"), null)).toBe("amount_required");
  });

  it("refuses an amount above a known order total", () => {
    expect(orderPrepaymentError(required("119.01"), 119)).toBe("amount_exceeds_total");
    expect(orderPrepaymentError(required("119,00"), 119)).toBeNull();
    // A new order has no total yet; its quote has to cover the amount.
    expect(orderPrepaymentError(required("5000"), null)).toBeNull();
  });

  it("sends the amount in cents and the due date when set", () => {
    expect(orderPrepaymentPayload(required("150,01", "2026-10-15T12:00:00Z"))).toEqual({
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
