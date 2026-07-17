import type { PortalAppointmentItem } from "@/pages/patients/model/portal-shared";
import { currentDateInput } from "./date-time";

const UPCOMING_PORTAL_APPOINTMENT_STATUSES = new Set([
  "planned",
  "confirmed",
  "in_progress",
]);

export function localCalendarDateInput(date = new Date()): string {
  return currentDateInput(date);
}

export function isUpcomingPortalAppointment(
  appointment: PortalAppointmentItem,
  today = localCalendarDateInput(),
): boolean {
  return (
    UPCOMING_PORTAL_APPOINTMENT_STATUSES.has(appointment.status) &&
    appointment.date >= today
  );
}
