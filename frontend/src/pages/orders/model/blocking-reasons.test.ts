import { describe, expect, it } from "vitest";

import {
  isOrderReadinessGateApplicable,
  orderBlockingReasonSection,
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

describe("orderBlockingReasonSection", () => {
  it("opens the task list for open execution checklist items", () => {
    expect(orderBlockingReasonSection("1 execution checklist item(s) remain open")).toBe("workflow");
    expect(orderBlockingReasonSection("12 execution checklist item(s) remain open")).toBe("workflow");
  });

  it("opens the follow-up section for results handoff and follow-up scheduling", () => {
    for (const reason of [
      "Results, Arztbrief or final patient handoff still need to be released",
      "Doctor-directed follow-up is required but not scheduled yet",
      "1-week follow-up is not scheduled yet",
      "1-month follow-up is not scheduled yet",
      "6-month follow-up is not scheduled yet",
      "Package-end follow-up is required but not scheduled yet",
      "No follow-up reminder, task or appointment has been launched yet",
    ]) {
      expect(orderBlockingReasonSection(reason), reason).toBe("followup");
    }
  });

  it("keeps execution evidence in the execution section", () => {
    for (const reason of [
      "Patient arrival or execution start is not recorded yet",
      "Medical execution must be completed and backed by delivered appointments or services",
      "Required non-medical services still need execution confirmation",
      "Interpreter-supported execution still needs completion or report confirmation",
      "Execution deviations or incidents must be resolved or marked as not required",
    ]) {
      expect(orderBlockingReasonSection(reason), reason).toBe("execution");
    }
  });

  it("sends completion blockers of the last phase to where they are closed", () => {
    for (const reason of [
      "Follow-up state has not been prepared",
      "1-week follow-up must be completed or marked not required",
      "6-month follow-up must be completed or marked not required",
      "Package-end follow-up must be completed or marked not required",
      "Results handoff must be completed or marked not required",
    ]) {
      expect(orderBlockingReasonSection(reason), reason).toBe("followup");
    }
    expect(orderBlockingReasonSection("4 workflow checklist item(s) are still open")).toBe("workflow");
    expect(orderBlockingReasonSection("2 service item(s) are not approved or invoiced")).toBe("services");
  });

  it("sends planning blockers to planning and everything else to the gates", () => {
    expect(orderBlockingReasonSection("Assigned interpreter has not confirmed yet")).toBe("planning");
    expect(orderBlockingReasonSection("Treatment plan must be finalized before execution")).toBe("planning");
    expect(orderBlockingReasonSection("2 required patient document(s) are missing")).toBe("planning");
    expect(orderBlockingReasonSection("Order signatures are still incomplete")).toBe("gates");
    expect(orderBlockingReasonSection("Order status must be active (currently paused)")).toBe("gates");
  });
});
