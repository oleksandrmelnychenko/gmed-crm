import type { OrderPipelineAppointment } from "./order-pipeline";
import type { OrderPlanningPreparation } from "./types";

export type InterpreterAssignmentState =
  | "not_required"
  | "unassigned"
  | "awaiting_acceptance"
  | "accepted";

export type InterpreterAssignmentCounters = Pick<
  OrderPlanningPreparation,
  | "interpreter_required"
  | "interpreter_assigned"
  | "interpreter_confirmed"
  | "interpreter_missing"
  | "interpreter_unconfirmed"
>;

/**
 * Where the order's interpreter assignment stands, from the planning counters.
 * Every open medical appointment needs its own interpreter, so one booking
 * among several visits is still "unassigned".
 */
export function interpreterAssignmentState(
  planning: InterpreterAssignmentCounters,
): InterpreterAssignmentState {
  if (!planning.interpreter_required) return "not_required";
  if (planning.interpreter_assigned <= 0 || (planning.interpreter_missing ?? 0) > 0) {
    return "unassigned";
  }
  return planning.interpreter_confirmed >= planning.interpreter_assigned &&
    (planning.interpreter_unconfirmed ?? 0) === 0
    ? "accepted"
    : "awaiting_acceptance";
}

/**
 * The interpreter line of the planning summary: "2 из 3 назначено / 1 принято"
 * over the open medical visits that need one (the readiness rule), so the
 * count says how many are still missing. Without that count (older backend,
 * or no medical visit yet) the plain booked/accepted numbers stay.
 */
export function interpreterPlanningSummary(
  planning: InterpreterAssignmentCounters &
    Pick<OrderPlanningPreparation, "interpreter_needed">,
  text: (key: string, values?: Record<string, string | number>) => string,
): string {
  const needed = planning.interpreter_needed;
  if (typeof needed !== "number" || needed <= 0) {
    return text("orders_planning_interpreter_summary", {
      assigned: planning.interpreter_assigned,
      confirmed: planning.interpreter_confirmed,
    });
  }
  const missing = Math.max(0, planning.interpreter_missing ?? 0);
  const unconfirmed = Math.max(0, planning.interpreter_unconfirmed ?? 0);
  const covered = Math.max(0, needed - missing);
  return text("orders_planning_interpreter_of_summary", {
    assigned: covered,
    needed,
    confirmed: Math.max(0, covered - unconfirmed),
  });
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
