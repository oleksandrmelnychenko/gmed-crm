import type { OrderPipelineAppointment } from "./order-pipeline";
import type { OrderPlanningPreparation } from "./types";

export type InterpreterAssignmentState =
  | "not_required"
  | "unassigned"
  | "awaiting_acceptance"
  | "accepted";

/** Where the order's interpreter assignment stands, from the planning counters. */
export function interpreterAssignmentState(
  planning: Pick<
    OrderPlanningPreparation,
    "interpreter_required" | "interpreter_assigned" | "interpreter_confirmed"
  >,
): InterpreterAssignmentState {
  if (!planning.interpreter_required) return "not_required";
  if (planning.interpreter_assigned <= 0) return "unassigned";
  return planning.interpreter_confirmed >= planning.interpreter_assigned
    ? "accepted"
    : "awaiting_acceptance";
}

/**
 * The order appointment to open for checking the interpreter: the first live
 * assignment the interpreter has not accepted yet, otherwise the first one.
 */
export function interpreterAppointmentToReview(
  appointments: readonly OrderPipelineAppointment[],
): OrderPipelineAppointment | null {
  const assigned = appointments.filter(
    (appointment) => appointment.status !== "cancelled" && Boolean(appointment.interpreter_name),
  );
  return (
    assigned.find((appointment) => appointment.interpreter_response !== "accepted") ??
    assigned[0] ??
    null
  );
}

/** Opens one appointment with its workflow tab, where the interpreter is assigned. */
export function appointmentWorkflowHref(appointmentId: string, patientId?: string | null) {
  const params = new URLSearchParams();
  if (patientId) params.set("patient", patientId);
  params.set("appointment", appointmentId);
  params.set("detailTab", "workflow");
  return `/appointments?${params.toString()}`;
}
