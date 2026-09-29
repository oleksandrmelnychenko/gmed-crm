import { describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api";

import { billingReversalRequestFromError } from "./billing-reversal-request";

function refusal(body: Record<string, unknown>) {
  return new ApiRequestError("conflict", { status: 409, body });
}

describe("billingReversalRequestFromError", () => {
  it("turns the billed-report refusal into a reversal request", () => {
    const onDone = vi.fn();
    const request = billingReversalRequestFromError(
      refusal({
        code: "appointment_cancel_billed_report",
        reverse_billing_available: true,
        interpreter_name: "Anna",
        hours: "1.5",
        order_number: "ORD-1",
        order_leistung_description: "Dolmetscher",
        reversal: { requires_credit_note: true, credit_total_gross: "119.00" },
      }),
      "appointment-1",
      "single",
      onDone,
    );
    expect(request).toMatchObject({
      appointmentId: "appointment-1",
      recurrenceScope: "single",
      interpreterName: "Anna",
      hours: "1,5",
      orderNumber: "ORD-1",
      lineDescription: "Dolmetscher",
    });
    expect(request?.reversal?.requires_credit_note).toBe(true);
    request?.onDone();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("ignores other errors and servers without the reversal option", () => {
    expect(
      billingReversalRequestFromError(refusal({ code: "other" }), "a", "single", () => {}),
    ).toBeNull();
    expect(
      billingReversalRequestFromError(
        refusal({ code: "appointment_cancel_billed_report" }),
        "a",
        "single",
        () => {},
      ),
    ).toBeNull();
    expect(billingReversalRequestFromError(new Error("x"), "a", "single", () => {})).toBeNull();
  });
});
