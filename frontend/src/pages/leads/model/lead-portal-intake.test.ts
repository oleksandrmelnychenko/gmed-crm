import { describe, expect, it } from "vitest";

import {
  guardianLinkRelation,
  isPatientPortalEvent,
  medicalDocumentsFactLabel,
  medicalDocumentsText,
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
    ).toEqual(["заполнено 9 из 11 полей", "2 медицинских документа", "данные отправлены 03.10.2026 11:30"]);
  });

  it("counts medical documents with the right plural form (QA 2026-10-11, A-11)", () => {
    const de = (_ru: string, text: string) => text;
    expect(medicalDocumentsText(0, tx)).toBe("0 медицинских документов");
    expect(medicalDocumentsText(1, tx)).toBe("1 медицинский документ");
    expect(medicalDocumentsText(2, tx)).toBe("2 медицинских документа");
    expect(medicalDocumentsText(5, tx)).toBe("5 медицинских документов");
    expect(medicalDocumentsText(11, tx)).toBe("11 медицинских документов");
    expect(medicalDocumentsText(21, tx)).toBe("21 медицинский документ");
    expect(medicalDocumentsText(1, de)).toBe("1 medizinisches Dokument");
    expect(medicalDocumentsText(2, de)).toBe("2 medizinische Dokumente");
    expect(medicalDocumentsFactLabel(tx)).toBe("Мед. документы");
    expect(medicalDocumentsFactLabel(de)).toBe("Med. Unterlagen");
  });

  it("finds the marker of a wizard field through its lead column", () => {
    const intake = { patient_fields: { date_of_birth: { at: "2026-10-03T09:00:00Z", access_kind: "self" as const } } };
    expect(patientMarkerFor(intake, "birthDate")?.access_kind).toBe("self");
    expect(patientMarkerFor(intake, "city")).toBeNull();
    expect(patientMarkerFor(null, "birthDate")).toBeNull();
  });

  it("keeps the relation of a parent after the login was issued (QA 2026-10-11, N-10)", () => {
    const candidates = [
      { trusted_contact_id: "c-1", access_id: "a-1", relation: "parent" },
      { trusted_contact_id: "c-2", access_id: null, relation: "guardian" },
    ];
    expect(guardianLinkRelation({ access_id: "a-1", trusted_contact_id: "c-1" }, candidates)).toBe("parent");
    // A renewed login: the access id changed, the contact is the same.
    expect(guardianLinkRelation({ access_id: "a-9", trusted_contact_id: "c-2" }, candidates)).toBe("guardian");
    expect(guardianLinkRelation({ access_id: "a-7", trusted_contact_id: null }, candidates)).toBeNull();
    expect(guardianLinkRelation({ access_id: "a-1", trusted_contact_id: "c-1" }, [])).toBeNull();
  });

  it("recognises events caused by the patient", () => {
    expect(isPatientPortalEvent({ type: "lead.portal_updated", payload: { access_kind: "self" } })).toBe(true);
    expect(isPatientPortalEvent({ type: "lead.portal_updated", payload: { change: "document_reviewed" } })).toBe(false);
    expect(isPatientPortalEvent({ type: "lead.updated", payload: { access_kind: "self" } })).toBe(false);
  });
});
