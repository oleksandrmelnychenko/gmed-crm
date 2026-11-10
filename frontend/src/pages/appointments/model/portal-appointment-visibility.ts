import type { PortalAppointmentItem } from "@/pages/patients/model/portal-shared";
import { berlinNowNaive } from "@/lib/app-time-zone";
import { currentDateInput } from "./date-time";

const UPCOMING_PORTAL_APPOINTMENT_STATUSES = new Set([
  "planned",
  "confirmed",
  "in_progress",
]);

export function localCalendarDateInput(date = new Date()): string {
  return currentDateInput(date);
}

/**
 * Whether a visit is still ahead of the patient: not completed or cancelled,
 * and not over. `now` is the Berlin wall clock ("YYYY-MM-DDTHH:mm[:ss]") or a
 * calendar day ("YYYY-MM-DD", the whole day counts then).
 *
 * A visit of today with times stops being "upcoming" once its end (else its
 * start) has passed: the visit of 09:00–10:00 was shown as the next one until
 * midnight (global QA 2026-11-10). A visit that is running (`in_progress`)
 * and one without a time stay for the day.
 */
export function isUpcomingPortalAppointment(
  appointment: Pick<PortalAppointmentItem, "status" | "date" | "time_start" | "time_end">,
  now: string = berlinNowNaive(),
): boolean {
  if (!UPCOMING_PORTAL_APPOINTMENT_STATUSES.has(appointment.status)) return false;
  const today = now.slice(0, 10);
  if (appointment.date !== today) return appointment.date > today;
  const clock = now.slice(11, 16);
  const end = (appointment.time_end || appointment.time_start || "").slice(0, 5);
  if (!clock || !end || appointment.status === "in_progress") return true;
  return end > clock;
}
