import { describe, expect, it } from "vitest";

import {
  isOrderReadinessGateApplicable,
  isOverageDeclineBlockingReason,
  isPatientInvoiceBlockingReason,
  joinBlockingReasons,
  orderBlockingReasonAnchor,
  orderBlockingReasonSection,
  prepaymentGateAmount,
  resolveOrderBlockingReason,
} from "./blocking-reasons";

describe("overage blockers (QA 2026-11-01, Z1 N2)", () => {
  it("opens where the blocker is resolved", () => {
    expect(orderBlockingReasonSection("1 approved package overage(s) have no quote to bill them")).toBe("services");
    expect(isOverageDeclineBlockingReason("1 approved package overage(s) have no price")).toBe(true);
    expect(isOverageDeclineBlockingReason("1 approved package overage(s) have no quote to bill them")).toBe(false);
  });
  it("shows the paid amount, not the rest of 0 (Z1 N7)", () => {
    const tracking = { required_amount: "119", remaining_amount: "0" };
    expect(prepaymentGateAmount({ ...tracking, status: "paid" })).toBe("119");
    expect(prepaymentGateAmount({ ...tracking, status: "awaiting_payment", remaining_amount: "119" })).toBe("119");
  });
});

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
  // Every reason of the existing-customer re-check (crates/server/src/routes/
  // patients.rs, "blocking_reasons.push"): none may show "Неизвестное значение"
  // in the create-order sheet (QA 2026-10-11 C-06, D-67).
  it("translates every existing-customer re-check reason", () => {
    for (const reason of [
      "Primary contact is missing",
      "Residence or address country is missing",
      "Preferred language is missing",
      "Compliance status is not completed",
      "DSGVO/compliance documents are not signed",
      "Medical confidentiality release is not signed",
      "Identity is not verified",
      "3 required patient document(s) are missing",
      "Valid contract documentation is missing",
      "Patient is still in debt-management hold",
      "2 overdue invoice(s) keep the patient in debt-management hold",
      "DSGVO consent was revoked on 12.10.2026",
      "Medical confidentiality release was revoked on 12.10.2026",
    ]) {
      expect(resolveOrderBlockingReason(reason), reason).not.toBeNull();
    }
    // A revoked consent names the day (owner decision 2026-10-12).
    expect(resolveOrderBlockingReason("DSGVO consent was revoked on 12.10.2026")).toEqual({
      key: "orders_blocking_dsgvo_consent_revoked",
      values: { date: "12.10.2026" },
    });
    expect(
      resolveOrderBlockingReason("Medical confidentiality release was revoked on 01.11.2026"),
    ).toEqual({
      key: "orders_blocking_confidentiality_release_revoked",
      values: { date: "01.11.2026" },
    });
    expect(resolveOrderBlockingReason("Medical confidentiality release is not signed")).toEqual({
      key: "orders_blocking_confidentiality_release_unsigned",
    });
  });

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

  it("lists open billing as blockers on the invoices section", () => {
    for (const reason of [
      "2 approved service item(s) are not invoiced yet",
      "1 draft patient invoice(s) are not issued yet",
      "Patient invoice RE-2026-0007 is not paid yet (overdue)",
    ]) {
      expect(orderBlockingReasonSection(reason), reason).toBe("invoices");
      expect(isPatientInvoiceBlockingReason(reason), reason).toBe(true);
    }
    expect(isPatientInvoiceBlockingReason("2 service item(s) are not approved or invoiced")).toBe(false);
    expect(isPatientInvoiceBlockingReason("4 workflow checklist item(s) are still open")).toBe(false);
    expect(resolveOrderBlockingReason("2 approved service item(s) are not invoiced yet")).toEqual({
      key: "orders_blocking_approved_services_uninvoiced_count",
      values: { count: 2 },
    });
    expect(resolveOrderBlockingReason("1 draft patient invoice(s) are not issued yet")).toEqual({
      key: "orders_blocking_draft_invoices_count",
      values: { count: 1 },
    });
    expect(
      resolveOrderBlockingReason("Patient invoice RE-2026-0007 is not paid yet (partially_paid)"),
    ).toEqual({
      key: "orders_blocking_patient_invoice_unpaid",
      values: { number: "RE-2026-0007" },
    });
  });

  it("sends an unbilled package overage to the invoices and names an undecided one", () => {
    const unbilled = "1 approved package overage(s) are not invoiced yet";
    expect(isPatientInvoiceBlockingReason(unbilled)).toBe(true);
    expect(resolveOrderBlockingReason(unbilled)).toEqual({
      key: "orders_blocking_package_overage_uninvoiced_count",
      values: { count: 1 },
    });
    expect(resolveOrderBlockingReason("2 package overage(s) still await a decision")).toEqual({
      key: "orders_blocking_package_overage_pending_count",
      values: { count: 2 },
    });
    // No quote or no price: not an invoices' matter, the blocker says what to do.
    const noQuote = "1 approved package overage(s) have no quote to bill them";
    expect(isPatientInvoiceBlockingReason(noQuote)).toBe(false);
    expect(resolveOrderBlockingReason(noQuote)).toEqual({
      key: "orders_blocking_package_overage_no_quote_count",
      values: { count: 1 },
    });
    expect(resolveOrderBlockingReason("3 approved package overage(s) have no price")).toEqual({
      key: "orders_blocking_package_overage_no_price_count",
      values: { count: 3 },
    });
  });

  it("joins reasons without doubling their full stops", () => {
    expect(joinBlockingReasons(["Открыто пунктов: 2.", "1 услуга не выставлена."])).toBe(
      "Открыто пунктов: 2; 1 услуга не выставлена",
    );
  });

  it("translates follow-up milestones that cannot count as completed yet", () => {
    expect(resolveOrderBlockingReason("1-week follow-up visit on 20.10.2026 is still open")).toEqual({
      key: "orders_blocking_followup_visit_open_1w",
      values: { date: "20.10.2026" },
    });
    expect(resolveOrderBlockingReason("Package-end follow-up visit on 01.03.2027 is still open")).toEqual({
      key: "orders_blocking_followup_visit_open_package_end",
      values: { date: "01.03.2027" },
    });
    expect(resolveOrderBlockingReason("6-month follow-up cannot be completed before 28.03.2027")).toEqual({
      key: "orders_blocking_followup_before_date_6m",
      values: { date: "28.03.2027" },
    });
    expect(resolveOrderBlockingReason("Doctor follow-up cannot be completed before 28.03.2027")).toBeNull();

    expect(orderBlockingReasonSection("6-month follow-up visit on 28.03.2027 is still open")).toBe("followup");
    expect(orderBlockingReasonAnchor("6-month follow-up visit on 28.03.2027 is still open")).toBe(
      "order-followup-milestones",
    );
    expect(orderBlockingReasonAnchor("1-month follow-up cannot be completed before 28.10.2026")).toBe(
      "order-followup-milestones",
    );
    expect(orderBlockingReasonAnchor("Doctor follow-up visit on 01.10.2026 is still open")).toBeNull();
  });

  it("opens each planning blocker at the block that resolves it", () => {
    expect(orderBlockingReasonAnchor("Treatment plan must be finalized before execution")).toBe(
      "order-planning-plan-agreement",
    );
    for (const reason of [
      "At least one confirmed medical appointment is required",
      "Required non-medical services still need a confirmed booking",
    ]) {
      expect(orderBlockingReasonAnchor(reason), reason).toBe("order-planning-appointments");
    }
    for (const reason of [
      "Interpreter is required but not assigned yet",
      "Assigned interpreter has not confirmed yet",
    ]) {
      expect(orderBlockingReasonAnchor(reason), reason).toBe("order-planning-interpreters");
    }
    for (const reason of [
      "Interpreter briefing is still pending",
      "Preparation documents still need to be sent",
    ]) {
      expect(orderBlockingReasonAnchor(reason), reason).toBe("order-planning-control");
    }
    // Missing patient documents have no control inside the section.
    expect(orderBlockingReasonAnchor("2 required patient document(s) are missing")).toBeNull();
    expect(orderBlockingReasonAnchor("Order signatures are still incomplete")).toBeNull();
  });

  it("sends planning blockers to planning and everything else to the gates", () => {
    expect(orderBlockingReasonSection("Assigned interpreter has not confirmed yet")).toBe("planning");
    expect(orderBlockingReasonSection("Treatment plan must be finalized before execution")).toBe("planning");
    expect(orderBlockingReasonSection("2 required patient document(s) are missing")).toBe("planning");
    expect(orderBlockingReasonSection("Order signatures are still incomplete")).toBe("gates");
    expect(orderBlockingReasonSection("Order status must be active (currently paused)")).toBe("gates");
  });
});
