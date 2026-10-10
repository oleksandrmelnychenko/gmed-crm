import { describe, expect, it } from "vitest";

import {
  isPatientPortalEvent,
  mergePatientUpdates,
  patientDataPending,
  patientDataPendingFields,
  patientMarkerFor,
  portalProgressText,
  relaxMasterErrors,
} from "./lead-portal-intake";

const tx = (ru: string) => ru;

describe("wizard step 1 in 'the patient fills it in' mode", () => {
  const errors = {
    firstName: "Обязательное поле",
    birthDate: "Обязательное поле",
    legalSex: "Обязательное поле",
    phone: "Введите корректный номер телефона",
    email: "Укажите электронную почту",
  };

  it("needs only names and e-mail, but keeps format errors of entered values", () => {
    const filled = (key: string) => key === "phone";
    expect(relaxMasterErrors(errors, "patient", filled)).toEqual({
      firstName: "Обязательное поле",
      phone: "Введите корректный номер телефона",
      email: "Укажите электронную почту",
    });
    expect(relaxMasterErrors(errors, "staff", filled)).toBe(errors);
  });

  it("waits for date of birth and legal sex before the prospect patient", () => {
    expect(patientDataPending("patient", { birthDate: "", legalSex: "female" })).toBe(true);
    expect(patientDataPending("patient", { birthDate: "1990-01-01", legalSex: "female" })).toBe(false);
    expect(patientDataPending("staff", { birthDate: "", legalSex: "" })).toBe(false);
    expect(patientDataPending("patient", null)).toBe(false);
  });

  it("names only the fields still empty (QA 2026-10-10)", () => {
    expect(patientDataPendingFields({ birthDate: "1985-05-12", legalSex: "" })).toEqual(["legalSex"]);
    expect(patientDataPendingFields({ birthDate: "", legalSex: "female" })).toEqual(["birthDate"]);
    expect(patientDataPendingFields({ birthDate: "", legalSex: "" })).toEqual(["birthDate", "legalSex"]);
    expect(patientDataPendingFields(null)).toEqual([]);
  });
});

describe("taking the patient's changes into an open wizard", () => {
  const base = { firstName: "Anna", city: "", birthDate: "", concern: "x" };

  it("updates only fields staff have not edited since the last load", () => {
    const current = { ...base, city: "Lviv" };
    const fresh = { ...base, city: "Kyiv", birthDate: "1990-01-01", concern: "y" };
    expect(mergePatientUpdates(current, base, fresh)).toEqual({ ...current, birthDate: "1990-01-01" });
  });

  it("returns null when nothing changes", () => {
    expect(mergePatientUpdates(base, base, { ...base })).toBeNull();
  });
});

describe("portal state labels", () => {
  it("names the progress and the time of sending", () => {
    expect(
      portalProgressText(
        { filled: 9, total: 11, documents: 2, submitted_at: "2026-10-03T09:30:00Z" },
        tx,
        () => "03.10.2026 11:30",
      ),
    ).toEqual(["заполнено 9 из 11 полей", "2 документов", "данные отправлены 03.10.2026 11:30"]);
  });

  it("finds the marker of a wizard field through its lead column", () => {
    const intake = { patient_fields: { date_of_birth: { at: "2026-10-03T09:00:00Z", access_kind: "self" as const } } };
    expect(patientMarkerFor(intake, "birthDate")?.access_kind).toBe("self");
    expect(patientMarkerFor(intake, "city")).toBeNull();
    expect(patientMarkerFor(null, "birthDate")).toBeNull();
  });

  it("recognises events caused by the patient", () => {
    expect(isPatientPortalEvent({ type: "lead.portal_updated", payload: { access_kind: "self" } })).toBe(true);
    expect(isPatientPortalEvent({ type: "lead.portal_updated", payload: { change: "document_reviewed" } })).toBe(false);
    expect(isPatientPortalEvent({ type: "lead.updated", payload: { access_kind: "self" } })).toBe(false);
  });
});
