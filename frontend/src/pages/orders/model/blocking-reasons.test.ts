import { describe, expect, it } from "vitest";

import {
  isOrderReadinessGateApplicable,
  resolveOrderBlockingReason,
} from "./blocking-reasons";

describe("isOrderReadinessGateApplicable", () => {
  it("only exposes blockers while their transition is actionable", () => {
    expect(isOrderReadinessGateApplicable("intake", "planning")).toBe(true);
    expect(isOrderReadinessGateApplicable("closure", "planning")).toBe(false);
    expect(isOrderReadinessGateApplicable("execution", "execution")).toBe(true);
    expect(isOrderReadinessGateApplicable("followup", "execution")).toBe(false);
    expect(isOrderReadinessGateApplicable("closure", "followup")).toBe(true);
    expect(isOrderReadinessGateApplicable("followup", "followup")).toBe(false);
  });
});

describe("resolveOrderBlockingReason", () => {
  it("maps every workflow blocker family to an i18n key", () => {
    expect(
      resolveOrderBlockingReason(
        "Treatment plan must be finalized before execution",
      ),
    ).toEqual({ key: "orders_blocking_treatment_plan_not_final" });
    expect(
      resolveOrderBlockingReason("1-month follow-up is not scheduled yet"),
    ).toEqual({ key: "orders_blocking_1m_followup_unscheduled" });
    expect(
      resolveOrderBlockingReason(
        "Interpreter-supported execution still needs completion or report confirmation",
      ),
    ).toEqual({ key: "orders_blocking_interpreter_execution_incomplete" });
  });

  it("normalizes dynamic debt reasons without leaking server text", () => {
    expect(
      resolveOrderBlockingReason(
        "2 overdue invoice(s) are awaiting payment confirmation; next review 2026-08-03T09:00:00Z",
      ),
    ).toEqual({
      key: "orders_debt_reason_awaiting_payment_overdue",
      values: { count: 2 },
    });
    expect(
      resolveOrderBlockingReason(
        "Debt-management payment plan is still open; next review 2026-08-03T09:00:00Z",
      ),
    ).toEqual({ key: "orders_debt_reason_payment_plan_open" });
  });

  it("returns null for unknown values so the localized generic fallback is used", () => {
    expect(resolveOrderBlockingReason("Unexpected future blocker")).toBeNull();
  });
});
