import { describe, expect, it } from "vitest";

import {
  appointmentWorkflowHref,
  interpreterAppointmentToReview,
  interpreterAssignmentState,
  interpreterPlanningLine,
  interpreterPlanningSummary,
} from "./interpreter-assignment";
import type { OrderPipelineAppointment } from "./order-pipeline";

describe("interpreterPlanningSummary", () => {
  const text = (key: string, values?: Record<string, string | number>) =>
    `${key}:${JSON.stringify(values)}`;
  const counters = {
    interpreter_required: true,
    interpreter_assigned: 3,
    interpreter_confirmed: 1,
    interpreter_missing: 1,
    interpreter_unconfirmed: 1,
  };

  it("counts the covered medical visits out of those that need an interpreter", () => {
    expect(interpreterPlanningSummary({ ...counters, interpreter_needed: 3 }, text)).toBe(
      'orders_planning_interpreter_of_summary:{"assigned":2,"needed":3,"confirmed":1}',
    );
  });

  it("shows booked interpreters even when the order flag says not required", () => {
    expect(
      interpreterPlanningLine({ ...counters, interpreter_required: false }, text),
    ).toBe('orders_planning_interpreter_summary:{"assigned":3,"confirmed":1}');
    expect(
      interpreterPlanningLine(
        { ...counters, interpreter_required: false, interpreter_assigned: 0 },
        text,
      ),
    ).toBe("orders_nicht_erforderlich:undefined");
  });

  it("keeps the plain counts without the needed number", () => {
    expect(interpreterPlanningSummary(counters, text)).toBe(
      'orders_planning_interpreter_summary:{"assigned":3,"confirmed":1}',
    );
    expect(interpreterPlanningSummary({ ...counters, interpreter_needed: 0 }, text)).toContain(
      "orders_planning_interpreter_summary:",
    );
  });
});

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

  it("keeps asking while an open medical appointment has no interpreter", () => {
    expect(
      interpreterAssignmentState({ ...planning(true, 1, 1), interpreter_missing: 2 }),
    ).toBe("unassigned");
    expect(
      interpreterAssignmentState({
        ...planning(true, 3, 3),
        interpreter_missing: 0,
        interpreter_unconfirmed: 0,
      }),
    ).toBe("accepted");
    expect(
      interpreterAssignmentState({
        ...planning(true, 3, 3),
        interpreter_missing: 0,
        interpreter_unconfirmed: 1,
      }),
    ).toBe("awaiting_acceptance");
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
