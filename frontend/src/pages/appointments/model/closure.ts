import { appointmentText } from "@/pages/appointments/model/labels";

/**
 * Why an appointment checklist item or reminder was closed without being
 * done (server `closed_reason`): the appointment was cancelled, the
 * interpreter was taken off the visit, or the automatic concierge workflow
 * was closed. Such items are closed but never count as completed.
 */
export type ClosureReason =
  | "appointment_cancelled"
  | "interpreter_unbooked"
  | "concierge_workflow_closed";

const CLOSURE_REASON_KEYS: Record<ClosureReason, string> = {
  appointment_cancelled: "appointments_closed_reason_appointment_cancelled",
  interpreter_unbooked: "appointments_closed_reason_interpreter_unbooked",
  concierge_workflow_closed: "appointments_closed_reason_concierge_workflow_closed",
};

type Closable = { is_completed: boolean; closed_reason?: string | null };

export function isClosedWithoutCompletion(item: Closable): boolean {
  return item.is_completed && Boolean(item.closed_reason);
}

/** Really completed (not merely closed because the work no longer applies). */
export function isActuallyCompleted(item: Closable): boolean {
  return item.is_completed && !item.closed_reason;
}

/** "Closed without completion (reason)" or null for open / completed items. */
export function closedWithoutCompletionLabel(item: Closable): string | null {
  if (!isClosedWithoutCompletion(item)) return null;
  const reasonKey = CLOSURE_REASON_KEYS[item.closed_reason as ClosureReason];
  const label = appointmentText("appointments_closed_without_completion");
  return reasonKey ? `${label} (${appointmentText(reasonKey)})` : label;
}

export const CLOSED_WITHOUT_COMPLETION_BADGE_CLASS =
  "inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] font-medium text-slate-600";
