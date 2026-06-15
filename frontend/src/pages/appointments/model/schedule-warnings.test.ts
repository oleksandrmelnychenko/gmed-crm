import { describe, expect, it } from "vitest";

import { formatScheduleConflictError } from "./schedule-warnings";

describe("formatScheduleConflictError", () => {
  it("formats backend conflict payloads with the existing appointment details", () => {
    const error = new Error("Appointment conflict");
    Object.assign(error, {
      status: 409,
      body: {
        conflicts: {
          patient_conflict_count: 1,
          interpreter_conflict_count: 1,
          doctor_conflict_count: 0,
          has_conflicts: true,
          patient_conflicts: [
            {
              id: "appointment-1",
              title: "Existing overlap",
              date: "2026-04-29",
              time_start: "09:00",
              time_end: "10:00",
              type: "medical",
              status: "confirmed",
              patient_name: "Anna Muster",
              patient_pid: "PT-001",
              provider_name: "Clinic Cologne",
              doctor_name: "Doctor Cologne",
              interpreter_name: "Interpreter One",
              is_blocked: false,
            },
          ],
          interpreter_conflicts: [
            {
              id: "appointment-1",
              title: "Existing overlap",
              date: "2026-04-29",
              time_start: "09:00",
              time_end: "10:00",
              type: "medical",
              status: "confirmed",
              patient_name: "Anna Muster",
              patient_pid: "PT-001",
              provider_name: "Clinic Cologne",
              doctor_name: "Doctor Cologne",
              interpreter_name: "Interpreter One",
              is_blocked: false,
            },
          ],
          doctor_conflicts: [],
        },
      },
    });

    const message = formatScheduleConflictError(error, "Failed");

    expect(message).toContain("Existing overlap");
    expect(message).toContain("09:00 - 10:00");
    expect(message).toContain("PT-001");
    expect(message).not.toBe("Appointment conflict");
  });
});
