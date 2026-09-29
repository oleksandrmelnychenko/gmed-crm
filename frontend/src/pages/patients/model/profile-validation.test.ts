import { describe, expect, it } from "vitest";

import type { PatientContactFormState, PatientTrustedContactFormState } from "./list-model";
import { patientProfileFieldKey, validatePatientProfileForm } from "./profile-validation";

const messages = {
  required: "Обязательное поле",
  invalidEmail: "Введите корректный адрес электронной почты",
  invalidPhone: "Введите корректный номер телефона",
};

const person = { firstName: "Anna", lastName: "Muster", birthDate: "1990-05-01", gender: "female" };

function contact(id: string, contactKind: "phone" | "email", value: string): PatientContactFormState {
  return { id, contactKind, contactType: "private", value, isPrimary: true, notes: "" };
}

function trusted(id: string, name: string, phone = "", notes = ""): PatientTrustedContactFormState {
  return { id, persistedId: null, name, phone, relation: "other", notes };
}

describe("validatePatientProfileForm", () => {
  it("rejects the e-mail and phone the lead wizard rejects", () => {
    const errors = validatePatientProfileForm(
      person,
      [contact("e1", "email", "bad@x"), contact("p1", "phone", "abc")],
      [],
      false,
      messages,
    );
    expect(errors).toEqual({
      [patientProfileFieldKey.contact("e1")]: messages.invalidEmail,
      [patientProfileFieldKey.contact("p1")]: messages.invalidPhone,
    });
  });

  it("accepts valid and empty optional contacts", () => {
    expect(validatePatientProfileForm(
      person,
      [
        contact("e1", "email", "anna@example.com"),
        contact("p1", "phone", "+49 151 1234567"),
        contact("e2", "email", "  "),
      ],
      [trusted("t1", "", "", "")],
      false,
      messages,
    )).toEqual({});
  });

  it("names the missing required personal data", () => {
    const errors = validatePatientProfileForm(
      { firstName: " ", lastName: "", birthDate: "", gender: "" },
      [],
      [],
      false,
      messages,
    );
    expect(Object.keys(errors).sort()).toEqual(["birthDate", "firstName", "gender", "lastName"]);
    expect(errors.firstName).toBe(messages.required);
  });

  it("requires a name for a filled trusted contact and a phone for a minor", () => {
    const errors = validatePatientProfileForm(
      person,
      [],
      [trusted("t1", "", "+49 151 1234567"), trusted("t2", "Petra")],
      true,
      messages,
    );
    expect(errors).toEqual({
      [patientProfileFieldKey.trustedName("t1")]: messages.required,
      [patientProfileFieldKey.trustedPhone("t2")]: messages.required,
    });
  });
});
