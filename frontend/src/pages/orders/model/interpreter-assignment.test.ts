import { describe, expect, it } from "vitest";

import {
  appointmentWorkflowHref,
  interpreterAppointmentToReview,
  interpreterAssignmentState,
} from "./interpreter-assignment";
import type { OrderPipelineAppointment } from "./order-pipeline";

function appointment(
  id: string,
  overrides: Partial<OrderPipelineAppointment> = {},
): OrderPipelineAppointment {
  return {
    id,
    title: `Visit ${id}`,
    appointment_type: "medical",
    date: "2026-10-01",
    time_start: "09:00",
    time_end: "10:00",
    status: "confirmed",
    location: null,
    provider_name: "Klinik",
    doctor_name: null,
    interpreter_name: null,
    interpreter_response: null,
    ...overrides,
  };
}

describe("interpreterAssignmentState", () => {
  const planning = (required: boolean, assigned: number, confirmed: number) => ({
    interpreter_required: required,
    interpreter_assigned: assigned,
    interpreter_confirmed: confirmed,
  });

  it("asks for an assignment until an interpreter is assigned", () => {
    expect(interpreterAssignmentState(planning(false, 0, 0))).toBe("not_required");
    expect(interpreterAssignmentState(planning(true, 0, 0))).toBe("unassigned");
  });

  it("is settled only once every assignment is accepted", () => {
    expect(interpreterAssignmentState(planning(true, 1, 0))).toBe("awaiting_acceptance");
    expect(interpreterAssignmentState(planning(true, 2, 1))).toBe("awaiting_acceptance");
    expect(interpreterAssignmentState(planning(true, 1, 1))).toBe("accepted");
  });
});

describe("interpreterAppointmentToReview", () => {
  it("prefers the assignment that still waits for the interpreter", () => {
    const target = interpreterAppointmentToReview([
      appointment("a", { interpreter_name: "Anna", interpreter_response: "accepted" }),
      appointment("b", { interpreter_name: "Boris", interpreter_response: "pending" }),
    ]);
    expect(target?.id).toBe("b");
  });

  it("falls back to the first accepted assignment and skips cancelled or unassigned visits", () => {
    const target = interpreterAppointmentToReview([
      appointment("a"),
      appointment("b", { interpreter_name: "Boris", status: "cancelled" }),
      appointment("c", { interpreter_name: "Clara", interpreter_response: "accepted" }),
    ]);
    expect(target?.id).toBe("c");
    expect(interpreterAppointmentToReview([appointment("a")])).toBeNull();
  });
});

describe("appointmentWorkflowHref", () => {
  it("opens the appointment's workflow tab for the patient", () => {
    expect(appointmentWorkflowHref("appt-1", "patient-1")).toBe(
      "/appointments?patient=patient-1&appointment=appt-1&detailTab=workflow",
    );
    expect(appointmentWorkflowHref("appt-1", null)).toBe(
      "/appointments?appointment=appt-1&detailTab=workflow",
    );
  });
});
