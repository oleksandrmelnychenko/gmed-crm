import { describe, expect, it } from "vitest";

import {
  isUpcomingPortalAppointment,
  localCalendarDateInput,
} from "./portal-appointment-visibility";
import type { PortalAppointmentItem } from "@/pages/patients/model/portal-shared";

const appointment = {
  id: "appointment-1",
  title: "Consultation",
  date: "2026-07-17",
  time_start: "09:00",
  time_end: "10:00",
  appointment_type: "medical",
  care_path_kind: "regular",
  status: "planned",
  location: null,
  category: null,
  provider_name: null,
  doctor_name: null,
  created_at: "2026-07-01T09:00:00Z",
} satisfies PortalAppointmentItem;

describe("portal appointment visibility", () => {
  it("formats the clinic calendar date in Europe/Berlin", () => {
    expect(localCalendarDateInput(new Date("2026-07-17T10:00:00Z"))).toBe(
      "2026-07-17",
    );
    expect(localCalendarDateInput(new Date("2026-07-16T22:30:00Z"))).toBe(
      "2026-07-17",
    );
  });

  it("keeps active future appointments and excludes terminal statuses", () => {
    expect(isUpcomingPortalAppointment(appointment, "2026-07-17")).toBe(true);
    expect(
      isUpcomingPortalAppointment(
        { ...appointment, status: "in_progress" },
        "2026-07-17",
      ),
    ).toBe(true);
    expect(
      isUpcomingPortalAppointment(
        { ...appointment, status: "completed" },
        "2026-07-17",
      ),
    ).toBe(false);
    expect(
      isUpcomingPortalAppointment(
        { ...appointment, status: "cancelled" },
        "2026-07-17",
      ),
    ).toBe(false);
  });
});
