import { currentDateInput } from "@/pages/appointments/model/date-time";

/** Error code the server returns when completion is requested too early. */
export const APPOINTMENT_COMPLETION_BEFORE_DATE_CODE =
  "appointment_completion_before_date";

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
