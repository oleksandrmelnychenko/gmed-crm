import { currentDateInput } from "@/pages/appointments/model/date-time";

/** Error code the server returns when completion is requested too early. */
export const APPOINTMENT_COMPLETION_BEFORE_DATE_CODE =
  "appointment_completion_before_date";

/** Error code the server returns when a report is submitted or approved too early. */
export const APPOINTMENT_REPORT_BEFORE_DATE_CODE = "appointment_report_before_date";

/** Error code the server returns when a reported appointment is moved to a future date. */
export const APPOINTMENT_REPORTED_FUTURE_DATE_CODE = "appointment_reported_future_date";

/** Error code the server returns when a report is sent for an unconfirmed appointment. */
export const APPOINTMENT_REPORT_STATUS_NOT_OPEN_CODE = "appointment_report_status_not_open";

/**
 * Interpreter reports (submit and approve) open once the coordinator has
 * confirmed the appointment; planned or cancelled appointments take none.
 */
export function isInterpreterReportStatusOpen(
  status: string | null | undefined,
): boolean {
  return status === "confirmed" || status === "in_progress" || status === "completed";
}

/**
 * Completion counts as delivery (billing lines, order execution), so it only
 * opens on the appointment's own day in Europe/Berlin. Same day is allowed.
 */
export function isAppointmentCompletionTooEarly(
  appointmentDate: string | null | undefined,
  today: string = currentDateInput(),
): boolean {
  const day = String(appointmentDate ?? "").slice(0, 10);
  return day.length === 10 && day > today;
}

/**
 * Interpreter reports follow the same rule: approval bills the reported hours,
 * so neither submitting nor approving a report opens before the appointment day.
 */
export const isInterpreterReportTooEarly = isAppointmentCompletionTooEarly;

/** Open targets of a completion scope that are still dated after today. */
export function futureCompletionTargets<
  T extends { date: string; status: string },
>(targets: readonly T[], today: string = currentDateInput()): T[] {
  return targets.filter(
    (item) =>
      item.status !== "completed" &&
      item.status !== "cancelled" &&
      isAppointmentCompletionTooEarly(item.date, today),
  );
}
