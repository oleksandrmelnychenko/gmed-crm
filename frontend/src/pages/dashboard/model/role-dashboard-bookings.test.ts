import { describe, expect, it } from "vitest";

import {
  dashboardBookingsPath,
  roleDashboardBookingItems,
  roleHasDashboardBookings,
  type DashboardAppointmentRow,
} from "./role-dashboard-bookings";

function row(overrides: Partial<DashboardAppointmentRow>): DashboardAppointmentRow {
  return {
    id: "a1",
    title: "MRT Knie",
    date: "2026-11-12",
    time_start: "14:00",
    status: "planned",
    patient_name: "Anna Portal",
    interpreter_id: "interpreter-1",
    interpreter_name: "Ivan Dolmetscher",
    interpreter_response: "pending",
    ...overrides,
  };
}

describe("role dashboard bookings", () => {
  it("is a queue of the interpreter roles only", () => {
    expect(roleHasDashboardBookings("interpreter")).toBe(true);
    expect(roleHasDashboardBookings("teamlead_interpreter")).toBe(true);
    expect(roleHasDashboardBookings("patient_manager")).toBe(false);
    expect(roleDashboardBookingItems([row({})], "pm-1", "patient_manager")).toEqual([]);
  });

  it("asks the booked interpreter for the answer that is still missing", () => {
    const rows = [
      row({ id: "later", date: "2026-11-20" }),
      row({ id: "first", date: "2026-11-12", time_start: "09:00" }),
      row({ id: "answered", interpreter_response: "accepted" }),
      row({ id: "declined", interpreter_response: "declined" }),
      row({ id: "cancelled", status: "cancelled" }),
      row({ id: "other", interpreter_id: "interpreter-2" }),
      row({ id: "no-answer-yet", interpreter_response: null, date: "2026-11-13" }),
    ];
    const items = roleDashboardBookingItems(rows, "interpreter-1", "interpreter");
    expect(items.map((item) => [item.id, item.kind])).toEqual([
      ["first", "answer_booking"],
      ["no-answer-yet", "answer_booking"],
      ["later", "answer_booking"],
    ]);
  });

  it("shows the team lead a declined booking it may re-plan", () => {
    const rows = [
      row({ id: "declined", interpreter_response: "declined", can_assign_interpreter: true }),
      // The server did not grant the assignment (older payload or closed visit).
      row({ id: "declined-no-right", interpreter_response: "declined" }),
      row({ id: "pending-of-other", interpreter_id: "interpreter-2" }),
      row({ id: "own", interpreter_id: "lead-1", date: "2026-11-11" }),
    ];
    expect(
      roleDashboardBookingItems(rows, "lead-1", "teamlead_interpreter").map((item) => [
        item.id,
        item.kind,
      ]),
    ).toEqual([
      ["own", "answer_booking"],
      ["declined", "replace_interpreter"],
    ]);
    // A plain interpreter never gets the re-planning item.
    expect(roleDashboardBookingItems(rows, "interpreter-9", "interpreter")).toEqual([]);
  });

  it("limits the list and loads one calendar window from today", () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      row({ id: `a${index}`, date: `2026-11-1${index}` }),
    );
    expect(roleDashboardBookingItems(rows, "interpreter-1", "interpreter", 2)).toHaveLength(2);
    expect(dashboardBookingsPath(new Date("2026-11-10T10:00:00Z"))).toBe(
      "/appointments?date_from=2026-11-10&date_to=2027-01-09",
    );
  });
});
