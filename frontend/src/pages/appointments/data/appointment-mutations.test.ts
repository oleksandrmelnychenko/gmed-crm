import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  apiFetch: apiFetchMock,
}));

import { updateAppointmentSchedule } from "./appointment-mutations";

describe("updateAppointmentSchedule", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockResolvedValue({ ok: true });
  });

  it("preserves raw times and explicit opt-out for an unbound medical drag", async () => {
    await updateAppointmentSchedule({
      appointmentId: "appointment-1",
      appointmentType: "medical",
      providerId: null,
      doctorId: null,
      ownerUserId: "owner-1",
      interpreterId: null,
      title: "Consultation",
      date: "2026-07-18",
      timeStart: "09:00",
      timeEnd: null,
      location: null,
      skipMedicalProviderBinding: true,
    });

    const [, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual(
      expect.objectContaining({
        time_start: "09:00",
        time_end: null,
        skip_medical_provider_binding: true,
      }),
    );
  });
});
