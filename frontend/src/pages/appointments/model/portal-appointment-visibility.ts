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
/**
 * Whether a visit lies in the past for the portal list, whatever its status:
 * an earlier day, or today with its end (else its start) passed. A running
 * visit (`in_progress`) and one of today without a time are not past yet.
 */
export function isPastPortalVisit(
  appointment: Pick<PortalAppointmentItem, "status" | "date" | "time_start" | "time_end">,
  now: string = berlinNowNaive(),
): boolean {
  const today = now.slice(0, 10);
  if (appointment.date !== today) return appointment.date < today;
  if (appointment.status === "in_progress") return false;
  const clock = now.slice(11, 16);
  const end = (appointment.time_end || appointment.time_start || "").slice(0, 5);
  if (!clock || !end) return false;
  return end <= clock;
}

/**
 * The portal visit list in reading order (QA 2026-11-12 S3-16: today's
 * finished visit stood above the «past» line): the visits still ahead in the
 * server's order, then the past ones newest first — today's finished ones
 * before the earlier days. `firstPastIndex` is -1 without past visits.
 */
export function orderPortalVisits<
  T extends Pick<PortalAppointmentItem, "status" | "date" | "time_start" | "time_end">,
>(appointments: readonly T[], now: string = berlinNowNaive()): { items: T[]; firstPastIndex: number } {
  const today = now.slice(0, 10);
  const ahead: T[] = [];
  const pastToday: T[] = [];
  const pastEarlier: T[] = [];
  for (const item of appointments) {
    if (!isPastPortalVisit(item, now)) ahead.push(item);
    else if (item.date === today) pastToday.unshift(item);
    else pastEarlier.push(item);
  }
  const past = [...pastToday, ...pastEarlier];
  return { items: [...ahead, ...past], firstPastIndex: past.length > 0 ? ahead.length : -1 };
}

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
