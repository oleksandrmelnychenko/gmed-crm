import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import {
  feedbackStatusLabel,
  formatPortalAverage,
  isOpenOwnServiceRequest,
  PORTAL_REQUEST_DATE_PROBLEM_KEYS,
  portalUpcomingServices,
  portalAppointmentPlaceLabel,
  portalDocumentTypeLabels,
  portalDocumentValueLabel,
  portalRequestDateProblem,
} from "./portal-shared";

describe("appointment request dates (global QA 2026-11-10)", () => {
  const today = "2026-11-10";

  it("refuses a period that ends before it starts and dates in the past", () => {
    expect(portalRequestDateProblem("2026-11-25", "2026-11-20", today)).toBe("inverted");
    expect(portalRequestDateProblem("2020-01-01", "2020-01-02", today)).toBe("past");
    expect(portalRequestDateProblem("2026-11-09", null, today)).toBe("past");
    expect(portalRequestDateProblem(null, "2026-11-09", today)).toBe("past");
  });

  it("takes today, later days and a request without dates", () => {
    expect(portalRequestDateProblem(today, today, today)).toBeNull();
    expect(portalRequestDateProblem("2026-11-20", "2026-11-25", today)).toBeNull();
    expect(portalRequestDateProblem("", "", today)).toBeNull();
    expect(portalRequestDateProblem(null, undefined, today)).toBeNull();
  });

  it("has a Russian and a German text for both refusals", () => {
    for (const key of Object.values(PORTAL_REQUEST_DATE_PROBLEM_KEYS)) {
      expect(t("ru").uiText[key], key).toBeTruthy();
      expect(t("de").uiText[key], key).toBeTruthy();
      expect(t("ru").uiText[key]).not.toMatch(/preferred_date|must be/);
    }
  });
});

describe("formatPortalAverage", () => {
  it("writes the average with a decimal comma, like the staff page", () => {
    expect(formatPortalAverage(5)).toBe("5,0");
    expect(formatPortalAverage(3.5)).toBe("3,5");
    expect(formatPortalAverage(4.94)).toBe("4,9");
  });
});

// Outside a browser the portal labels follow the default language (Russian).
const ru = t("ru");

describe("portalDocumentTypeLabels", () => {
  it("names a type and a category with the same label once", () => {
    // "medical_report" and "report" are both "medical report" in the portal.
    expect(portalDocumentTypeLabels("medical_report", "report")).toEqual([
      portalDocumentValueLabel("medical_report"),
    ]);
  });

  it("keeps a category that says more than the type", () => {
    expect(portalDocumentTypeLabels("passport_scan", "identity")).toEqual([
      portalDocumentValueLabel("passport_scan"),
      portalDocumentValueLabel("identity"),
    ]);
  });

  it("skips an empty category", () => {
    expect(portalDocumentTypeLabels("invoice", null)).toEqual([portalDocumentValueLabel("invoice")]);
    expect(portalDocumentTypeLabels("invoice", " ")).toHaveLength(1);
  });
});

describe("portalAppointmentPlaceLabel", () => {
  it("names clinic and doctor, else the free-text location", () => {
    expect(
      portalAppointmentPlaceLabel({
        provider_name: "Charité Berlin",
        doctor_name: "Dr. Mia Muster",
        location: "Clinic Berlin",
      }),
    ).toBe("Charité Berlin / Dr. Mia Muster");
    expect(
      portalAppointmentPlaceLabel({ provider_name: null, doctor_name: " ", location: "Clinic Berlin" }),
    ).toBe("Clinic Berlin");
    expect(portalAppointmentPlaceLabel({ provider_name: null, doctor_name: null, location: null })).toBe("");
  });
});

describe("feedbackStatusLabel", () => {
  it("names the feedback states instead of an unknown value", () => {
    expect(feedbackStatusLabel("submitted")).toBe(ru.feedback_status_submitted);
    expect(feedbackStatusLabel("reviewed")).toBe(ru.feedback_status_reviewed);
    expect(feedbackStatusLabel("archived")).toBe(ru.feedback_status_archived);
    expect(feedbackStatusLabel("something_else")).toBe(ru.common_unknown_value);
  });
});

describe("portal services (concierge QA 2026-11-12 D-8, D-9)", () => {
  it("counts only the patient's own requests nobody booked yet", () => {
    expect(isOpenOwnServiceRequest({ request_source: "patient_portal", status: "planned" })).toBe(true);
    expect(isOpenOwnServiceRequest({ request_source: "patient_portal", status: "confirmed" })).toBe(false);
    expect(isOpenOwnServiceRequest({ request_source: "staff", status: "planned" })).toBe(false);
  });

  it("lists open services soonest first, closed ones after", () => {
    const services = [
      { id: "late", status: "confirmed", starts_at: "2026-11-20T09:00:00Z" },
      { id: "done", status: "completed", starts_at: "2026-11-01T09:00:00Z" },
      { id: "no-time", status: "planned", starts_at: null },
      { id: "evening", status: "confirmed", starts_at: "2026-11-14T19:00:00Z" },
      { id: "noon", status: "confirmed", starts_at: "2026-11-14T13:30:00Z" },
    ];
    expect(portalUpcomingServices(services).map((item) => item.id)).toEqual([
      "noon",
      "evening",
      "late",
      "no-time",
    ]);
  });
});
