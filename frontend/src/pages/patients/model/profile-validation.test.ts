import { describe, expect, it } from "vitest";

import {
  blankPatientForm,
  patientTrustedContactsFromRelations,
  patientTrustedContactsToPayload,
  type PatientContactFormState,
  type PatientTrustedContactFormState,
} from "./list-model";
import {
  isGermanyCountry,
  newPatientFieldKey,
  patientProfileFieldKey,
  postalCodeError,
  validateNewPatientForm,
  validatePatientProfileForm,
  withMinorGuardianRelations,
} from "./profile-validation";

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
  return { id, persistedId: null, relatedPatientId: null, name, phone, email: "", relation: "other", notes };
}

describe("validatePatientProfileForm", () => {
  it("round-trips a linked mother with e-mail only without losing identity or role", () => {
    const contacts = patientTrustedContactsFromRelations([{
      id: "relation-mother", related_patient_id: "patient-mother",
      related_name: "Anna Muster", relation_type: "mother", is_emergency_contact: true,
      email: "anna@example.test", phone: null,
    }]);
    expect(validatePatientProfileForm(person, [], contacts, true, messages)).toEqual({});
    expect(patientTrustedContactsToPayload(withMinorGuardianRelations(contacts, true))[0]).toMatchObject({
      persistedId: "relation-mother", relatedPatientId: "patient-mother",
      relation: "mother", email: "anna@example.test", phone: "",
    });
    expect(validateNewPatientForm({ ...blankPatientForm(), ...person, trustedContacts: contacts }, true, {
      ...messages, zipGermany: "zip", zipInvalid: "zip", minorNeedsGuardian: "guardian",
    })).toEqual({});
  });

  it("retains both explicit parent roles and rejects malformed contact channels", () => {
    const contacts = [
      { ...trusted("mother", "Anna", "abc"), relation: "mother", email: "bad@x" },
      { ...trusted("father", "Ben", "+49 151 1234567"), relation: "father" },
    ];
    expect(withMinorGuardianRelations(contacts, true).map(c => c.relation)).toEqual(["mother", "father"]);
    expect(validatePatientProfileForm(person, [], contacts, true, messages)).toEqual({
      [patientProfileFieldKey.trustedPhone("mother")]: messages.invalidPhone,
      [patientProfileFieldKey.trustedEmail("mother")]: messages.invalidEmail,
    });
  });
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

const zipMessages = { zipGermany: "Deutsche PLZ: 5 Ziffern", zipInvalid: "Nur Buchstaben und Ziffern" };

describe("postalCodeError", () => {
  it("wants five digits in Germany", () => {
    expect(postalCodeError("10115", "DE", zipMessages)).toBeUndefined();
    expect(postalCodeError(" 10115 ", "de", zipMessages)).toBeUndefined();
    expect(postalCodeError("10115Герман", "DE", zipMessages)).toBe(zipMessages.zipGermany);
    expect(postalCodeError("1011", "DE", zipMessages)).toBe(zipMessages.zipGermany);
    expect(postalCodeError("D-10115", "Deutschland", zipMessages)).toBe(zipMessages.zipGermany);
  });

  it("allows letters, digits, spaces and hyphens elsewhere", () => {
    expect(postalCodeError("SW1A 1AA", "GB", zipMessages)).toBeUndefined();
    expect(postalCodeError("00-950", "PL", zipMessages)).toBeUndefined();
    expect(postalCodeError("01001", "", zipMessages)).toBeUndefined();
    expect(postalCodeError("01001 Киев", "UA", zipMessages)).toBe(zipMessages.zipInvalid);
    expect(postalCodeError("12345678901", "AT", zipMessages)).toBe(zipMessages.zipInvalid);
    expect(postalCodeError("-1234", "AT", zipMessages)).toBe(zipMessages.zipInvalid);
  });

  it("leaves an empty postal code alone", () => {
    expect(postalCodeError("  ", "DE", zipMessages)).toBeUndefined();
  });

  it("recognises Germany by code and by older stored names", () => {
    expect(["DE", "deu", "Germany", "Deutschland", "Германия"].every(isGermanyCountry)).toBe(true);
    expect(isGermanyCountry("AT")).toBe(false);
    expect(isGermanyCountry(null)).toBe(false);
  });
});

describe("validateNewPatientForm", () => {
  const newPatientMessages = {
    ...messages,
    ...zipMessages,
    minorNeedsGuardian: "Elternteil oder Vormund mit Telefon",
  };

  it("does not accept the blank form: the sex has no default", () => {
    const errors = validateNewPatientForm(blankPatientForm(), false, newPatientMessages);
    expect(Object.keys(errors).sort()).toEqual(["birthDate", "firstName", "gender", "lastName"]);
  });

  it("checks the postal code against the address country", () => {
    const errors = validateNewPatientForm(
      { ...blankPatientForm(), ...person, addressZip: "10115Г", addressCountry: "DE" },
      false,
      newPatientMessages,
    );
    expect(errors).toEqual({ [newPatientFieldKey.addressZip]: zipMessages.zipGermany });
  });

  it("asks a minor for a parent or guardian with name and phone", () => {
    const minor = { ...blankPatientForm(), ...person, birthDate: "2015-03-01" };
    expect(validateNewPatientForm(minor, true, newPatientMessages)).toEqual({
      [newPatientFieldKey.guardian]: newPatientMessages.minorNeedsGuardian,
    });
    const guardian = { ...trusted("t1", "Ben Muster", "+49 151 1234567"), relation: "guardian" };
    expect(
      validateNewPatientForm({ ...minor, trustedContacts: [guardian] }, true, newPatientMessages),
    ).toEqual({});
  });
});

describe("withMinorGuardianRelations", () => {
  it("saves a minor's contact as the guardian the form shows", () => {
    const contacts = [trusted("t1", "Ben Muster"), { ...trusted("t2", "Mia Muster"), relation: "parent" }];
    expect(withMinorGuardianRelations(contacts, true).map((contact) => contact.relation)).toEqual([
      "guardian",
      "parent",
    ]);
    expect(withMinorGuardianRelations(contacts, false)).toBe(contacts);
  });
});
