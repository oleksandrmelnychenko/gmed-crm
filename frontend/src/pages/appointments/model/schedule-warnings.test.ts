import { describe, expect, it } from "vitest";

import {
  buildLocalScheduleWarnings,
  formatScheduleConflictError,
} from "./schedule-warnings";
import type { AppointmentListItem } from "./types";

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

  it("localizes retryable concurrency conflicts", () => {
    const error = new Error("Appointment schedule is being modified; retry");
    Object.assign(error, {
      status: 409,
      body: { retryable: true },
    });

    expect(formatScheduleConflictError(error, "Failed")).not.toBe(
      error.message,
    );
  });
});

describe("buildLocalScheduleWarnings", () => {
  const appointments = [
    {
      id: "timed",
      date: "2026-06-18",
      time_start: "09:00",
      time_end: "10:00",
      status: "planned",
      owner_user_id: "owner-1",
    },
    {
      id: "all-day",
      date: "2026-06-18",
      time_start: null,
      time_end: null,
      status: "planned",
      owner_user_id: "owner-1",
    },
  ] as AppointmentListItem[];

  it("does not invent a slot for a one-sided time pair", () => {
    expect(
      buildLocalScheduleWarnings(appointments, {
        date: "2026-06-18",
        timeStart: "09:30",
        timeEnd: "",
        ownerUserId: "owner-1",
      }),
    ).toEqual([]);
  });

  it("treats an all-day appointment as blocking timed slots on that date", () => {
    const warnings = buildLocalScheduleWarnings(appointments, {
      appointmentId: "timed",
      date: "2026-06-18",
      timeStart: "09:30",
      timeEnd: "10:30",
      ownerUserId: "owner-1",
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].items.map((item) => item.id)).toEqual(["all-day"]);
  });
});
