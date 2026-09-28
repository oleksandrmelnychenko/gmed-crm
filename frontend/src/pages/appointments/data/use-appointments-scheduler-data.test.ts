import { describe, expect, it } from "vitest";

import { uiText } from "@/lib/i18n";

import { settleAppointmentsSchedulerResults } from "./use-appointments-scheduler-data";
import type { AppointmentListItem } from "../model/types";

describe("settleAppointmentsSchedulerResults", () => {
  it("keeps successfully loaded appointments when attention loading fails", () => {
    const rows = [
      {
        id: "appointment-1",
        title: "Consultation",
      },
    ] as AppointmentListItem[];

    const patch = settleAppointmentsSchedulerResults(
      { status: "fulfilled", value: rows },
      { status: "rejected", reason: new Error("Attention unavailable") },
      "Appointments unavailable",
      "Attention unavailable",
    );

    expect(patch.appointments).toBe(rows);
    expect(patch.appointmentsError).toBe("");
    expect(patch.attentionError).toBe("Attention unavailable");
    expect(patch).not.toHaveProperty("attentionItems");
  });

  it("preserves the current grid when a refresh fails", () => {
    const patch = settleAppointmentsSchedulerResults(
      { status: "rejected", reason: new Error("Appointments unavailable") },
      { status: "fulfilled", value: [] },
      "Appointments unavailable",
      "Attention unavailable",
    );

    expect(patch).not.toHaveProperty("appointments");
    expect(patch.appointmentsError).toBe("Appointments unavailable");
  });

  it("names a concierge's blocked medical slot in the UI language", () => {
    const rows = [
      { id: "slot-1", title: "Blocked medical slot", is_blocked: true },
      { id: "dinner", title: "Dinner Restaurant Borchardt", is_blocked: false },
    ] as AppointmentListItem[];

    const patch = settleAppointmentsSchedulerResults(
      { status: "fulfilled", value: rows },
      { status: "fulfilled", value: [] },
      "Appointments unavailable",
      "Attention unavailable",
    );

    expect(patch.appointments?.[0].title).toBe(uiText("appointments_blocked_slot"));
    expect(patch.appointments?.[0].title).not.toBe("Blocked medical slot");
    expect(patch.appointments?.[1]).toBe(rows[1]);
  });
});
