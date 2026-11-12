import { describe, expect, it } from "vitest";

import {
  isPastPortalVisit,
  isUpcomingPortalAppointment,
  localCalendarDateInput,
  orderPortalVisits,
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

  it("drops a visit of today once it is over (global QA 2026-11-10)", () => {
    // 09:00–10:00: ahead in the morning, over in the afternoon.
    expect(isUpcomingPortalAppointment(appointment, "2026-07-17T08:30:00")).toBe(true);
    expect(isUpcomingPortalAppointment(appointment, "2026-07-17T09:30:00")).toBe(true);
    expect(isUpcomingPortalAppointment(appointment, "2026-07-17T10:00:00")).toBe(false);
    expect(isUpcomingPortalAppointment(appointment, "2026-07-17T16:15:00")).toBe(false);
    // Without an end the start decides; without any time the day counts.
    expect(
      isUpcomingPortalAppointment({ ...appointment, time_end: null }, "2026-07-17T09:01:00"),
    ).toBe(false);
    expect(
      isUpcomingPortalAppointment({ ...appointment, time_start: null, time_end: null }, "2026-07-17T23:00:00"),
    ).toBe(true);
    // A running visit stays; other days follow the date alone.
    expect(
      isUpcomingPortalAppointment({ ...appointment, status: "in_progress" }, "2026-07-17T16:15:00"),
    ).toBe(true);
    expect(isUpcomingPortalAppointment(appointment, "2026-07-16T23:59:00")).toBe(true);
    expect(isUpcomingPortalAppointment(appointment, "2026-07-18T00:01:00")).toBe(false);
  });
});

describe("portal visit list order (QA 2026-11-12 S3-16)", () => {
  const visit = (id: string, date: string, time_start: string | null, status = "planned") => ({
    id,
    date,
    time_start,
    time_end: null,
    status,
  });

  it("moves today's finished visit below the past line, newest first", () => {
    const now = "2026-11-12T14:00:00";
    const { items, firstPastIndex } = orderPortalVisits(
      [
        visit("today-morning", "2026-11-12", "09:00:00"),
        visit("today-afternoon", "2026-11-12", "16:00:00"),
        visit("tomorrow", "2026-11-13", "10:00:00"),
        visit("yesterday", "2026-11-11", "10:00:00"),
      ],
      now,
    );
    expect(items.map((item) => item.id)).toEqual(["today-afternoon", "tomorrow", "today-morning", "yesterday"]);
    expect(firstPastIndex).toBe(2);
  });

  it("keeps a running visit and one without a time ahead", () => {
    const now = "2026-11-12T14:00:00";
    expect(isPastPortalVisit(visit("running", "2026-11-12", "09:00:00", "in_progress"), now)).toBe(false);
    expect(isPastPortalVisit(visit("no-time", "2026-11-12", null), now)).toBe(false);
    expect(orderPortalVisits([visit("tomorrow", "2026-11-13", null)], now).firstPastIndex).toBe(-1);
  });
});
