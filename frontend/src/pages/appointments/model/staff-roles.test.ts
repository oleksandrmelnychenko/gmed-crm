import { describe, expect, it } from "vitest";

import {
  activePatientAssigneeIds,
  canRemindAboutAppointment,
  filterAppointmentOwnerOptions,
  isAppointmentOwnerRole,
  isAppointmentReminderRecipient,
  isAppointmentTaskAssignableRole,
} from "./staff-roles";

describe("appointment reminder recipients", () => {
  it("leaves billing and IT, who cannot open appointments, out of every reminder", () => {
    expect(isAppointmentReminderRecipient("billing")).toBe(false);
    expect(isAppointmentReminderRecipient("it_admin")).toBe(false);
    expect(isAppointmentReminderRecipient("sales")).toBe(false);
    expect(isAppointmentReminderRecipient("concierge")).toBe(true);
    expect(isAppointmentReminderRecipient("interpreter")).toBe(true);
  });

  const visit = {
    status: "confirmed",
    interpreter_id: "interpreter-1",
    interpreter_response: "accepted",
    owner_user_id: "pm-owner",
  };
  const assignees = activePatientAssigneeIds([
    { user_id: "pm-1", revoked_at: null },
    { user_id: "concierge-1", revoked_at: null },
    { user_id: "interpreter-2", revoked_at: null },
    { user_id: "concierge-2", revoked_at: "2026-09-01T10:00:00Z" },
  ]);
  const remindable = (id: string, role: string, appointment = visit) =>
    canRemindAboutAppointment({ id, role }, appointment, assignees);

  it("offers an interpreter only while booked on the appointment", () => {
    expect(remindable("interpreter-1", "interpreter")).toBe(true);
    // Linked to the patient through another visit, but not booked on this one.
    expect(remindable("interpreter-2", "interpreter")).toBe(false);
    expect(
      remindable("interpreter-1", "interpreter", {
        ...visit,
        interpreter_response: "declined",
      }),
    ).toBe(false);
    expect(
      remindable("interpreter-1", "interpreter", { ...visit, status: "cancelled" }),
    ).toBe(false);
  });

  it("offers other roles only with access to the appointment", () => {
    expect(remindable("pm-1", "patient_manager")).toBe(true);
    expect(remindable("pm-owner", "patient_manager")).toBe(true);
    expect(remindable("pm-2", "patient_manager")).toBe(false);
    expect(remindable("concierge-1", "concierge")).toBe(true);
    expect(remindable("concierge-2", "concierge")).toBe(false);
    expect(remindable("interpreter-1", "teamlead_interpreter")).toBe(true);
    expect(remindable("teamlead-9", "teamlead_interpreter")).toBe(false);
    expect(remindable("ceo-1", "ceo")).toBe(true);
    // Billing is not a reminder recipient on any visit, not even as an
    // assignee or owner: it cannot open appointments.
    expect(remindable("billing-1", "billing")).toBe(false);
    expect(
      remindable("billing-1", "billing", { ...visit, owner_user_id: "billing-1" }),
    ).toBe(false);
    expect(remindable("it-1", "it_admin")).toBe(false);
    expect(remindable("sales-1", "sales")).toBe(false);
    // The read-only CEO assistant could never complete the reminder.
    expect(remindable("assistant-1", "ceo_assistant")).toBe(false);
  });
});

const staff = [
  { id: "ceo-1", role: "ceo" },
  { id: "pm-1", role: "patient_manager" },
  { id: "teamlead-1", role: "teamlead_interpreter" },
  { id: "teamlead-2", role: "teamlead_interpreter" },
  { id: "interpreter-1", role: "interpreter" },
  { id: "concierge-1", role: "concierge" },
  { id: "it-1", role: "it_admin" },
  { id: "billing-1", role: "billing" },
];

describe("appointment staff roles", () => {
  it("offers as owners only roles that can open and work on appointments", () => {
    for (const role of ["ceo", "patient_manager"]) {
      expect(
        filterAppointmentOwnerOptions(staff, role, `${role}-me`).map(
          (member) => member.id,
        ),
      ).toEqual(["ceo-1", "pm-1", "teamlead-1", "teamlead-2", "concierge-1"]);
    }
    expect(isAppointmentOwnerRole("it_admin")).toBe(false);
    expect(isAppointmentOwnerRole("interpreter")).toBe(false);
    expect(isAppointmentOwnerRole("billing")).toBe(false);
    expect(isAppointmentOwnerRole("ceo_assistant")).toBe(false);
    expect(isAppointmentOwnerRole("concierge")).toBe(true);
  });

  it("limits teamlead ownership to self and other teamleads", () => {
    expect(
      filterAppointmentOwnerOptions(
        staff,
        "teamlead_interpreter",
        "teamlead-1",
      ).map((member) => member.id),
    ).toEqual(["teamlead-1", "teamlead-2"]);
  });

  it("limits concierge ownership to self and offers IT admin nothing", () => {
    expect(
      filterAppointmentOwnerOptions(staff, "concierge", "concierge-1").map(
        (member) => member.id,
      ),
    ).toEqual(["concierge-1"]);
    expect(filterAppointmentOwnerOptions(staff, "it_admin", "it-1")).toEqual([]);
  });

  it("excludes IT admin from task assignees", () => {
    expect(isAppointmentTaskAssignableRole("it_admin")).toBe(false);
    expect(isAppointmentTaskAssignableRole("interpreter")).toBe(true);
  });
});
