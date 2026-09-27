import { describe, expect, it } from "vitest";

import { resolveFollowUpDefaultAssignee } from "./form-factories";
import type { AppointmentDetail, PatientAssignment } from "./types";
import { buildHandoffStakeholders } from "./workflow-helpers";

function assignment(user_id: string, user_role: string): PatientAssignment {
  return {
    user_id,
    user_name: user_id,
    user_role,
    user_active: true,
    assigned_by: "pm-1",
    assigned_by_name: null,
    assigned_at: "2026-09-01T08:00:00Z",
    revoked_at: null,
  };
}

const detail = {
  id: "appointment-1",
  type: "medical",
  status: "confirmed",
  interpreter_id: "interpreter-booked",
  interpreter_name: "Booked interpreter",
  interpreter_response: "accepted",
  owner_user_id: "interpreter-owner",
  owner_name: "Owning interpreter",
  owner_role: "interpreter",
} as unknown as AppointmentDetail;

describe("reminder recipients among the appointment's people", () => {
  it("marks only people the server accepts a reminder for", () => {
    const stakeholders = buildHandoffStakeholders(detail, [
      assignment("concierge-1", "concierge"),
      assignment("interpreter-linked", "interpreter"),
    ]);
    const remindable = Object.fromEntries(
      stakeholders.map((item) => [item.id, item.canReceiveReminder]),
    );
    expect(remindable).toEqual({
      "concierge-1": true,
      "interpreter-booked": true,
      // Linked to the patient or owning the visit is not enough for an
      // interpreter; only the booking counts.
      "interpreter-linked": false,
      "interpreter-owner": false,
    });
  });

  it("defaults the follow-up reminder to someone who can receive it", () => {
    expect(
      resolveFollowUpDefaultAssignee(detail, [
        assignment("interpreter-linked", "interpreter"),
        assignment("concierge-1", "concierge"),
      ]),
    ).toBe("concierge-1");
    expect(
      resolveFollowUpDefaultAssignee(detail, [
        assignment("concierge-1", "concierge"),
        assignment("pm-1", "patient_manager"),
      ]),
    ).toBe("pm-1");
    expect(
      resolveFollowUpDefaultAssignee(detail, [assignment("interpreter-linked", "interpreter")]),
    ).toBe("");
  });
});
