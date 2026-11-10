import { addDaysToDateKey, appDateKey } from "@/lib/app-time-zone";

/**
 * Interpreter bookings that wait for somebody, shown first in "Focus today"
 * of the interpreter and the interpreter team lead (QA 2026-11-10, D-16 and
 * the owner decision on D-14):
 *
 * - `answer_booking`: the signed-in interpreter was booked and has not
 *   answered yet (the notification says "confirm or decline");
 * - `replace_interpreter`: the booked interpreter declined and the team lead
 *   may book another one.
 */
export type DashboardBookingKind = "answer_booking" | "replace_interpreter";

export type DashboardBookingItem = {
  id: string;
  kind: DashboardBookingKind;
  title: string;
  date: string;
  timeStart: string | null;
  patientName: string;
  interpreterName: string | null;
};

/** The fields of an appointment list row the dashboard reads. */
export type DashboardAppointmentRow = {
  id: string;
  title: string;
  date: string;
  time_start: string | null;
  status: string;
  patient_name: string;
  interpreter_id: string | null;
  interpreter_name: string | null;
  interpreter_response: string | null;
  is_blocked?: boolean;
  can_assign_interpreter?: boolean;
};

const BOOKING_ROLES = new Set(["interpreter", "teamlead_interpreter"]);

/** Days ahead the dashboard looks for bookings (one calendar window of the list). */
const BOOKING_WINDOW_DAYS = 60;

export function roleHasDashboardBookings(role: string | null | undefined): boolean {
  return Boolean(role && BOOKING_ROLES.has(role));
}

/** The appointment list request of the dashboard: today and the next weeks. */
export function dashboardBookingsPath(now: Date = new Date()): string {
  const from = appDateKey(now);
  const to = addDaysToDateKey(from, BOOKING_WINDOW_DAYS);
  return `/appointments?date_from=${from}&date_to=${to}`;
}

function isOpen(row: DashboardAppointmentRow): boolean {
  return !row.is_blocked && row.status !== "completed" && row.status !== "cancelled";
}

export function roleDashboardBookingItems(
  rows: readonly DashboardAppointmentRow[],
  userId: string | null | undefined,
  role: string | null | undefined,
  limit = 4,
): DashboardBookingItem[] {
  if (!userId || !roleHasDashboardBookings(role)) return [];
  const items: DashboardBookingItem[] = [];
  for (const row of rows) {
    if (!isOpen(row) || !row.interpreter_id) continue;
    const response = row.interpreter_response ?? "pending";
    let kind: DashboardBookingKind | null = null;
    if (row.interpreter_id === userId && response === "pending") {
      kind = "answer_booking";
    } else if (
      role === "teamlead_interpreter" &&
      response === "declined" &&
      row.can_assign_interpreter === true
    ) {
      kind = "replace_interpreter";
    }
    if (!kind) continue;
    items.push({
      id: row.id,
      kind,
      title: row.title,
      date: row.date,
      timeStart: row.time_start,
      patientName: row.patient_name,
      interpreterName: row.interpreter_name,
    });
  }
  return items
    .sort((left, right) =>
      `${left.date}${left.timeStart ?? ""}`.localeCompare(`${right.date}${right.timeStart ?? ""}`),
    )
    .slice(0, Math.max(0, limit));
}
