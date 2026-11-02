import { describe, expect, it } from "vitest";

import {
  groupAppointmentsByDay,
  groupAppointmentsByDoctor,
  isShownToPatient,
  planningDoctorsFromCareTeam,
  plannedDayLabel,
  plannedTimeLabel,
  unreleasedPlanCount,
} from "./order-planned-appointments";
import type { OrderPipelineAppointment } from "./order-pipeline";

function appointment(
  id: string,
  overrides: Partial<OrderPipelineAppointment> = {},
): OrderPipelineAppointment {
  return {
    id,
    title: id,
    appointment_type: "medical",
    date: "2026-11-02",
    time_start: null,
    time_end: null,
    status: "planned",
    location: null,
    provider_name: null,
    doctor_name: null,
    interpreter_name: null,
    interpreter_response: null,
    ...overrides,
  };
}

describe("order planned appointments", () => {
  it("groups by day in the server's order and leaves cancelled ones out", () => {
    const groups = groupAppointmentsByDay([
      appointment("a", { date: "2026-11-02" }),
      appointment("b", { date: "2026-11-02" }),
      appointment("cancelled", { date: "2026-11-03", status: "cancelled" }),
      appointment("c", { date: "2026-11-04" }),
    ]);

    expect(groups.map((group) => group.date)).toEqual(["2026-11-02", "2026-11-04"]);
    expect(groups[0].appointments.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("tells doctors of the same name apart by provider and keeps the unassigned last", () => {
    const groups = groupAppointmentsByDoctor([
      appointment("none"),
      appointment("a", { provider_name: "Klinik A", doctor_name: "Dr. Weber" }),
      appointment("b", { provider_name: "Klinik B", doctor_name: "Dr. Weber" }),
      appointment("c", { provider_name: "Klinik A", doctor_name: "Dr. Weber" }),
      appointment("d", { provider_name: "Klinik A" }),
    ]);

    expect(groups.map((group) => group.appointments.map((item) => item.id))).toEqual([
      ["a", "c"],
      ["b"],
      ["d"],
      ["none"],
    ]);
    expect(groups[2]).toMatchObject({ doctorName: null, providerName: "Klinik A" });
  });

  it("groups by doctor id and adds the planned doctors without a visit yet", () => {
    const groups = groupAppointmentsByDoctor(
      [
        appointment("none"),
        appointment("a", {
          provider_id: "klinik", provider_name: "Klinik A", doctor_id: "weber", doctor_name: "Dr. Weber",
        }),
        appointment("b", {
          provider_id: "klinik", provider_name: "Klinik A (alt)", doctor_id: "weber", doctor_name: "Dr. Weber",
        }),
      ],
      [
        { providerId: "klinik", providerName: "Klinik A", doctorId: "weber", doctorName: "Dr. Weber" },
        { providerId: "labor", providerName: "Labor B", doctorId: null, doctorName: null },
        { providerId: "labor", providerName: "Labor B", doctorId: null, doctorName: null },
      ],
    );

    expect(groups.map((group) => [group.providerId, group.doctorId, group.appointments.length])).toEqual([
      ["klinik", "weber", 2],
      ["labor", null, 0],
      [null, null, 1],
    ]);
  });

  it("plans with the medical members of the care team only", () => {
    const member = {
      provider_id: "klinik", provider_name: "Klinik A", provider_type: "medical",
      doctor_id: "weber", doctor_name: "Dr. Weber", doctor_title: null, doctor_specialty: null,
      services: 1, appointments: 0,
    };
    expect(
      planningDoctorsFromCareTeam([member, { ...member, provider_id: "hotel", provider_type: "non_medical" }]),
    ).toEqual([{ providerId: "klinik", providerName: "Klinik A", doctorId: "weber", doctorName: "Dr. Weber" }]);
  });

  it("labels the day and the time", () => {
    expect(plannedDayLabel("2026-11-02", "de")).toBe("Mo, 02.11.2026");
    expect(plannedDayLabel("2026-11-02", "ru")).toBe("Пн, 02.11.2026");
    expect(
      plannedTimeLabel(appointment("a", { time_start: "10:00:00", time_end: "11:30:00" })),
    ).toBe("10:00–11:30");
    expect(plannedTimeLabel(appointment("a", { time_start: "10:00:00" }))).toBe("10:00");
    expect(plannedTimeLabel(appointment("a"))).toBe("");
  });

  it("counts the planned appointments the patient does not see yet", () => {
    const released = appointment("released", { portal_released_at: "2026-11-02T10:00:00Z" });
    const legacy = appointment("legacy");
    const hidden = appointment("hidden", { portal_released_at: null });
    const internal = appointment("internal", { appointment_type: "internal", portal_released_at: null });
    const cancelled = appointment("cancelled", { status: "cancelled", portal_released_at: null });

    expect(isShownToPatient(released)).toBe(true);
    expect(isShownToPatient(legacy)).toBe(true);
    expect(isShownToPatient(hidden)).toBe(false);
    expect(isShownToPatient(internal)).toBe(true);
    expect(unreleasedPlanCount([released, legacy, hidden, internal, cancelled])).toBe(1);
  });
});
