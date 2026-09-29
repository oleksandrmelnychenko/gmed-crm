import type { UiTextValues } from "@/lib/i18n";

import type { OrderSectionKey } from "../sections";

export type OrderBlockingReasonTranslation = {
  key: string;
  values?: UiTextValues;
};

export type OrderReadinessGate =
  | "process"
  | "planning"
  | "execution"
  | "followup";

export function isOrderReadinessGateApplicable(
  phase: string | null | undefined,
  gate: OrderReadinessGate,
) {
  switch (gate) {
    case "process":
    case "planning":
      return phase === "intake";
    case "execution":
      return phase === "execution";
    case "followup":
      return phase === "closure";
  }
}

const EXACT_REASON_KEYS: Record<string, string> = {
  "Billing release is not granted and package coverage is not confirmed":
    "orders_blocking_billing_release_package_coverage",
  "Order signatures are still incomplete":
    "orders_blocking_signatures_incomplete",
  "Advance invoice exists but payment is still missing":
    "orders_blocking_advance_invoice_missing_payment",
  "Treatment plan must be finalized before execution":
    "orders_blocking_treatment_plan_not_final",
  "At least one confirmed medical appointment is required":
    "orders_blocking_medical_appointment_required",
  "Required non-medical services still need a confirmed booking":
    "orders_blocking_non_medical_booking_required",
  "Interpreter is required but not assigned yet":
    "orders_blocking_interpreter_not_assigned",
  "Assigned interpreter has not confirmed yet":
    "orders_blocking_interpreter_not_confirmed",
  "Interpreter briefing is still pending":
    "orders_blocking_interpreter_briefing_pending",
  "Preparation documents still need to be sent":
    "orders_blocking_preparation_documents_pending",
  "Patient arrival or execution start is not recorded yet":
    "orders_blocking_patient_arrival_missing",
  "Medical execution must be completed and backed by delivered appointments or services":
    "orders_blocking_medical_execution_incomplete",
  "Required non-medical services still need execution confirmation":
    "orders_blocking_non_medical_execution_missing",
  "Interpreter-supported execution still needs completion or report confirmation":
    "orders_blocking_interpreter_execution_incomplete",
  "Execution deviations or incidents must be resolved or marked as not required":
    "orders_blocking_execution_deviations_unresolved",
  "Results, Arztbrief or final patient handoff still need to be released":
    "orders_blocking_results_handoff_unreleased",
  "Doctor-directed follow-up is required but not scheduled yet":
    "orders_blocking_doctor_followup_unscheduled",
  "1-week follow-up is not scheduled yet":
    "orders_blocking_1w_followup_unscheduled",
  "1-month follow-up is not scheduled yet":
    "orders_blocking_1m_followup_unscheduled",
  "6-month follow-up is not scheduled yet":
    "orders_blocking_6m_followup_unscheduled",
  "Package-end follow-up is required but not scheduled yet":
    "orders_blocking_package_end_followup_unscheduled",
  "No follow-up reminder, task or appointment has been launched yet":
    "orders_blocking_no_followup_launched",
  "Primary contact is missing": "orders_blocking_primary_contact_missing",
  "Residence or address country is missing": "orders_blocking_country_missing",
  "Preferred language is missing": "orders_blocking_preferred_language_missing",
  "Compliance status is not completed": "orders_blocking_compliance_incomplete",
  "DSGVO/compliance documents are not signed":
    "orders_blocking_compliance_documents_unsigned",
  "Identity is not verified": "orders_blocking_identity_unverified",
  "Valid contract documentation is missing":
    "orders_blocking_contract_documentation_missing",
  "Patient is still in debt-management hold": "orders_blocking_debt_hold",
  "Existing-customer re-check is not required before the first operational order":
    "orders_blocking_existing_customer_recheck_not_required",
};

const OPEN_DEBT_REASON_KEYS: Record<string, string> = {
  "Debt-management review is still open": "orders_debt_reason_review_open",
  "Debt-management payment plan is still open":
    "orders_debt_reason_payment_plan_open",
  "Debt-management is still awaiting payment confirmation":
    "orders_debt_reason_awaiting_payment_open",
  "Debt-management escalation is still open":
    "orders_debt_reason_escalated_open",
};

const OVERDUE_DEBT_REASON_KEYS: Record<string, string> = {
  "require debt-management review": "orders_debt_reason_review_overdue",
  "are in payment-plan handling": "orders_debt_reason_payment_plan_overdue",
  "are awaiting payment confirmation":
    "orders_debt_reason_awaiting_payment_overdue",
  "are in escalated debt-management": "orders_debt_reason_escalated_overdue",
};

// Follow-up milestones in the server's blocking reasons (label -> key suffix).
const FOLLOWUP_MILESTONE_REASON_SUFFIX: Record<string, string> = {
  "Doctor follow-up": "doctor",
  "1-week follow-up": "1w",
  "1-month follow-up": "1m",
  "6-month follow-up": "6m",
  "Package-end follow-up": "package_end",
};
const FOLLOWUP_VISIT_OPEN_REASON =
  /^(Doctor follow-up|1-week follow-up|1-month follow-up|6-month follow-up|Package-end follow-up) visit on (\d{2}\.\d{2}\.\d{4}) is still open$/;
const FOLLOWUP_BEFORE_DATE_REASON =
  /^(1-week follow-up|1-month follow-up|6-month follow-up) cannot be completed before (\d{2}\.\d{2}\.\d{4})$/;

/**
 * A follow-up milestone that cannot count as completed yet: a visit of it is
 * still open (completion follows the visits) or its planned date is ahead.
 */
function followupCompletionReason(reason: string): OrderBlockingReasonTranslation | null {
  const openVisit = reason.match(FOLLOWUP_VISIT_OPEN_REASON);
  if (openVisit) {
    return {
      key: `orders_blocking_followup_visit_open_${FOLLOWUP_MILESTONE_REASON_SUFFIX[openVisit[1]]}`,
      values: { date: openVisit[2] },
    };
  }
  const beforeDate = reason.match(FOLLOWUP_BEFORE_DATE_REASON);
  if (beforeDate) {
    return {
      key: `orders_blocking_followup_before_date_${FOLLOWUP_MILESTONE_REASON_SUFFIX[beforeDate[1]]}`,
      values: { date: beforeDate[2] },
    };
  }
  return null;
}

export function resolveOrderBlockingReason(
  reason: string,
): OrderBlockingReasonTranslation | null {
  const exactKey = EXACT_REASON_KEYS[reason];
  if (exactKey) return { key: exactKey };

  const followupCompletion = followupCompletionReason(reason);
  if (followupCompletion) return followupCompletion;

  const patientDebtHold = reason.match(
    /^(\d+) overdue invoice\(s\) keep the patient in debt-management hold$/,
  );
  if (patientDebtHold) {
    return {
      key: "orders_debt_reason_patient_hold",
      values: { count: Number(patientDebtHold[1]) },
    };
  }

  const overdueDebt = reason.match(
    /^(\d+) overdue invoice\(s\) (require debt-management review|are in payment-plan handling|are awaiting payment confirmation|are in escalated debt-management)(?:; next review .+)?$/,
  );
  if (overdueDebt) {
    return {
      key:
        OVERDUE_DEBT_REASON_KEYS[overdueDebt[2]] ??
        "orders_debt_reason_review_overdue",
      values: { count: Number(overdueDebt[1]) },
    };
  }

  const normalizedDebtReason = reason.replace(/; next review .+$/, "");
  const openDebtKey = OPEN_DEBT_REASON_KEYS[normalizedDebtReason];
  if (openDebtKey) return { key: openDebtKey };

  const executionChecklist = reason.match(
    /^(\d+) execution checklist item\(s\) remain open$/,
  );
  if (executionChecklist) {
    return {
      key: "orders_blocking_execution_checklist_open_count",
      values: { count: Number(executionChecklist[1]) },
    };
  }

  // Billing closure (owner decision 2026-09-28): approved services invoiced
  // and no open patient invoice before follow-up or completion.
  const approvedUninvoiced = reason.match(
    /^(\d+) approved service item\(s\) are not invoiced yet$/,
  );
  if (approvedUninvoiced) {
    return {
      key: "orders_blocking_approved_services_uninvoiced_count",
      values: { count: Number(approvedUninvoiced[1]) },
    };
  }
  const draftInvoices = reason.match(/^(\d+) draft patient invoice\(s\) are not issued yet$/);
  if (draftInvoices) {
    return {
      key: "orders_blocking_draft_invoices_count",
      values: { count: Number(draftInvoices[1]) },
    };
  }
  const unpaidInvoice = reason.match(/^Patient invoice (.+) is not paid yet \((\w+)\)$/);
  if (unpaidInvoice) {
    return {
      key: "orders_blocking_patient_invoice_unpaid",
      values: { number: unpaidInvoice[1] },
    };
  }

  const missingDocuments = reason.match(
    /^(\d+) required patient document\(s\) are missing$/,
  );
  if (missingDocuments) {
    return {
      key: "orders_blocking_missing_required_patient_documents_count",
      values: { count: Number(missingDocuments[1]) },
    };
  }

  return null;
}

const PLANNING_REASONS = new Set([
  "Treatment plan must be finalized before execution",
  "At least one confirmed medical appointment is required",
  "Required non-medical services still need a confirmed booking",
  "Interpreter is required but not assigned yet",
  "Assigned interpreter has not confirmed yet",
  "Interpreter briefing is still pending",
  "Preparation documents still need to be sent",
]);

const EXECUTION_REASONS = new Set([
  "Patient arrival or execution start is not recorded yet",
  "Medical execution must be completed and backed by delivered appointments or services",
  "Required non-medical services still need execution confirmation",
  "Interpreter-supported execution still needs completion or report confirmation",
  "Execution deviations or incidents must be resolved or marked as not required",
]);

// Results handoff and the follow-up schedule are recorded in the follow-up
// section ("Наблюдение"), not in execution.
const FOLLOWUP_REASONS = new Set([
  "Results, Arztbrief or final patient handoff still need to be released",
  "Doctor-directed follow-up is required but not scheduled yet",
  "1-week follow-up is not scheduled yet",
  "1-month follow-up is not scheduled yet",
  "6-month follow-up is not scheduled yet",
  "Package-end follow-up is required but not scheduled yet",
  "No follow-up reminder, task or appointment has been launched yet",
]);

// Completion blockers of the last phase: the follow-up milestones are closed
// in the follow-up section as well.
const COMPLETION_FOLLOWUP_REASONS = new Set([
  "Follow-up state has not been prepared",
  "Doctor follow-up must be completed or marked not required",
  "1-week follow-up must be completed or marked not required",
  "1-month follow-up must be completed or marked not required",
  "6-month follow-up must be completed or marked not required",
  "Package-end follow-up must be completed or marked not required",
  "Results handoff must be completed or marked not required",
]);

// Follow-up milestones are planned in the milestone planner of the follow-up
// section, not in the calendar.
const FOLLOWUP_MILESTONE_REASONS = new Set([
  "1-week follow-up is not scheduled yet",
  "1-month follow-up is not scheduled yet",
  "6-month follow-up is not scheduled yet",
  "No follow-up reminder, task or appointment has been launched yet",
  "1-week follow-up must be completed or marked not required",
  "1-month follow-up must be completed or marked not required",
  "6-month follow-up must be completed or marked not required",
]);

const BILLING_RELEASE_REASON =
  "Billing release is not granted and package coverage is not confirmed";

/**
 * The blocker is decided by billing (the billing release), so a user without
 * invoice finance rights can only wait for it: no action is offered to them.
 */
export function orderBlockingReasonWaitsForBilling(
  reason: string,
  canDecideBillingRelease: boolean,
): boolean {
  return reason === BILLING_RELEASE_REASON && !canDecideBillingRelease;
}

/** DOM id of the follow-up milestone planner (see `OrderFollowupMilestones`). */
export const FOLLOWUP_MILESTONES_ANCHOR_ID = "order-followup-milestones";

/**
 * Element inside the target section that resolves the blocker, if any: the
 * "Open" link scrolls to it after opening the section.
 */
export function orderBlockingReasonAnchor(reason: string): string | null {
  if (FOLLOWUP_MILESTONE_REASONS.has(reason)) return FOLLOWUP_MILESTONES_ANCHOR_ID;
  // The 1-week / 1-month / 6-month contacts are closed in the planner.
  const completion = reason.match(FOLLOWUP_VISIT_OPEN_REASON) ?? reason.match(FOLLOWUP_BEFORE_DATE_REASON);
  return completion && /^\d-(week|month) follow-up$/.test(completion[1])
    ? FOLLOWUP_MILESTONES_ANCHOR_ID
    : null;
}

/**
 * Order workspace section where a lifecycle blocker is resolved; the "Open"
 * link of the blocker list navigates there. Reasons are the server's texts.
 */
export function orderBlockingReasonSection(reason: string): OrderSectionKey {
  if (
    PLANNING_REASONS.has(reason) ||
    /^\d+ required patient document\(s\) are missing$/.test(reason)
  ) {
    return "planning";
  }
  // Checklist items are worked off in the order task list ("Задачи").
  if (
    /^\d+ execution checklist item\(s\) remain open$/.test(reason) ||
    /^\d+ workflow checklist item\(s\) are still open$/.test(reason)
  ) {
    return "workflow";
  }
  // Services still planned or delivered are approved, invoiced or cancelled
  // in the service list.
  if (/^\d+ service item\(s\) are not approved or invoiced$/.test(reason)) {
    return "services";
  }
  // Open billing is closed on the invoices section of the order.
  if (
    /^\d+ approved service item\(s\) are not invoiced yet$/.test(reason) ||
    /^\d+ draft patient invoice\(s\) are not issued yet$/.test(reason) ||
    /^Patient invoice .+ is not paid yet \(\w+\)$/.test(reason)
  ) {
    return "invoices";
  }
  if (EXECUTION_REASONS.has(reason)) return "execution";
  if (
    FOLLOWUP_REASONS.has(reason) ||
    COMPLETION_FOLLOWUP_REASONS.has(reason) ||
    followupCompletionReason(reason)
  ) {
    return "followup";
  }
  return "gates";
}
