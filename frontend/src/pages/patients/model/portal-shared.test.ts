import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import {
  feedbackStatusLabel,
  portalAppointmentPlaceLabel,
  portalDocumentTypeLabels,
  portalDocumentValueLabel,
} from "./portal-shared";

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
