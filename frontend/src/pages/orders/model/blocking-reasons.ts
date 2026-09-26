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

export function resolveOrderBlockingReason(
  reason: string,
): OrderBlockingReasonTranslation | null {
  const exactKey = EXACT_REASON_KEYS[reason];
  if (exactKey) return { key: exactKey };

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
  if (EXECUTION_REASONS.has(reason)) return "execution";
  if (FOLLOWUP_REASONS.has(reason) || COMPLETION_FOLLOWUP_REASONS.has(reason)) {
    return "followup";
  }
  return "gates";
}
