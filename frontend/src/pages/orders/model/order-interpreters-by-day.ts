import type { OrderPipelineAppointment } from "./order-pipeline";
import { groupAppointmentsByDay, type PlannedAppointmentGroup } from "./order-planned-appointments";

/** A completed appointment takes no new interpreter (server rule). */
export function canTakeInterpreter(appointment: OrderPipelineAppointment) {
  return appointment.status !== "completed" && appointment.status !== "cancelled";
}

/**
 * Whether the planning readiness counts the appointment as still without an
 * interpreter: an open medical visit with nobody booked, or a declined booking.
 */
export function needsInterpreter(appointment: OrderPipelineAppointment) {
  if (appointment.appointment_type !== "medical" || !canTakeInterpreter(appointment)) return false;
  return !appointment.interpreter_name || appointment.interpreter_response === "declined";
}

export type InterpreterDay = PlannedAppointmentGroup & {
  /** Appointments of the day that can still take an interpreter. */
  assignableIds: string[];
  /** Open medical appointments of the day without an interpreter. */
  missingCount: number;
};

/** The order's planned appointments by day, with what the day still needs. */
export function interpreterDays(
  appointments: readonly OrderPipelineAppointment[],
): InterpreterDay[] {
  return groupAppointmentsByDay(appointments).map((group) => ({
    ...group,
    assignableIds: group.appointments.filter(canTakeInterpreter).map((item) => item.id),
    missingCount: group.appointments.filter(needsInterpreter).length,
  }));
}

/**
 * The appointments a day action preselects: those without an interpreter (or
 * with a declined booking); when every one is covered, all open ones, so the
 * day can be handed to another interpreter in one step.
 */
export function defaultDaySelection(day: InterpreterDay): string[] {
  const open = day.appointments.filter(canTakeInterpreter);
  const uncovered = open.filter(
    (item) => !item.interpreter_name || item.interpreter_response === "declined",
  );
  return (uncovered.length > 0 ? uncovered : open).map((item) => item.id);
}

export type BatchFailure = {
  appointment_id: string;
  code?: string;
  message?: string;
};

/** Per-appointment refusals from a 403/409 of the batch endpoint. */
export function batchFailures(body: unknown): BatchFailure[] {
  if (!body || typeof body !== "object") return [];
  const failures = (body as { failures?: unknown }).failures;
  if (!Array.isArray(failures)) return [];
  return failures.filter(
    (item): item is BatchFailure =>
      !!item && typeof item === "object" && typeof (item as BatchFailure).appointment_id === "string",
  );
}
