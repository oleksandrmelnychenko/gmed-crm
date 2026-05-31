import { describe, expect, it } from "vitest";

import {
  filterAppointmentOwnerOptions,
  isAppointmentTaskAssignableRole,
} from "./staff-roles";

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
  it("keeps IT admin selectable for CEO and patient manager owners", () => {
    expect(
      filterAppointmentOwnerOptions(staff, "patient_manager", "pm-1").map(
        (member) => member.id,
      ),
    ).toEqual([
      "ceo-1",
      "pm-1",
      "teamlead-1",
      "teamlead-2",
      "interpreter-1",
      "concierge-1",
      "it-1",
    ]);
  });

  it("limits teamlead ownership to self, teamleads and interpreters", () => {
    expect(
      filterAppointmentOwnerOptions(
        staff,
        "teamlead_interpreter",
        "teamlead-1",
      ).map((member) => member.id),
    ).toEqual(["teamlead-1", "teamlead-2", "interpreter-1"]);
  });

  it("limits concierge and IT admin ownership to self", () => {
    expect(
      filterAppointmentOwnerOptions(staff, "concierge", "concierge-1").map(
        (member) => member.id,
      ),
    ).toEqual(["concierge-1"]);
    expect(
      filterAppointmentOwnerOptions(staff, "it_admin", "it-1").map(
        (member) => member.id,
      ),
    ).toEqual(["it-1"]);
  });

  it("excludes IT admin from task assignees", () => {
    expect(isAppointmentTaskAssignableRole("it_admin")).toBe(false);
    expect(isAppointmentTaskAssignableRole("interpreter")).toBe(true);
  });
});
