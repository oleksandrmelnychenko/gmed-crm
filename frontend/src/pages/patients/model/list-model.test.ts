import { describe, expect, it } from "vitest";

import {
  collectPatientInsuranceTypeOptions,
  filterPatientsByInsuranceType,
  makePatientTrustedContactForm,
  patientTrustedContactIdentityPayload,
  patientTrustedContactsFromRelations,
  patientTrustedContactsToPayload,
} from "./list-model";

const patients = [
  { insurance_type: "foreign" },
  { insurance_type: "private" },
  { insurance_type: "private" }, // duplicate
  { insurance_type: "" }, // blank -> ignored
  { insurance_type: null }, // null -> ignored
  { insurance_type: "self_pay" },
  { insurance_type: "AOK" }, // non-type legacy value -> ignored
];

describe("collectPatientInsuranceTypeOptions", () => {
  it("returns distinct insurance types in canonical order and ignores blanks/legacy provider names", () => {
    expect(collectPatientInsuranceTypeOptions(patients)).toEqual(["private", "self_pay", "foreign"]);
  });

  it("returns an empty list when nobody has an insurance type", () => {
    expect(
      collectPatientInsuranceTypeOptions([{ insurance_type: null }, { insurance_type: "" }]),
    ).toEqual([]);
  });
});

describe("filterPatientsByInsuranceType", () => {
  it("returns all patients when no insurance type is selected", () => {
    expect(filterPatientsByInsuranceType(patients, "")).toBe(patients);
    expect(filterPatientsByInsuranceType(patients, "   ")).toBe(patients);
  });

  it("keeps only patients with the selected insurance type", () => {
    expect(filterPatientsByInsuranceType(patients, "private")).toEqual([
      { insurance_type: "private" },
      { insurance_type: "private" },
    ]);
    expect(filterPatientsByInsuranceType(patients, "foreign")).toEqual([{ insurance_type: "foreign" }]);
  });

  it("returns nothing when no patient carries the selected insurance type", () => {
    expect(filterPatientsByInsuranceType(patients, "public")).toEqual([]);
  });
});

describe("trusted patient contacts", () => {
  it("loads every emergency relation and preserves its persisted id", () => {
    expect(patientTrustedContactsFromRelations([
      {
        id: "relation-1",
        related_patient_id: "patient-sister",
        related_name: "Olena Onboarding",
        relation_type: "Sister",
        is_emergency_contact: true,
        phone: "+380 44 555 0101",
        email: "olena@example.test",
        notes: "Email: olena@example.test",
      },
      {
        id: "relation-2",
        related_name: "Petro Onboarding",
        related_display_name: "Petro O.",
        relation_type: "Brother",
        is_emergency_contact: true,
        phone: "+380 44 555 0102",
        notes: null,
        birth_date: "1984-03-02",
        citizenships: ["ua", "DE"],
      },
      {
        id: "relation-3",
        related_name: "Treating doctor",
        relation_type: "other",
        is_emergency_contact: false,
      },
    ])).toEqual([
      {
        id: "relation-1",
        persistedId: "relation-1",
        relatedPatientId: "patient-sister",
        name: "Olena Onboarding",
        phone: "+380 44 555 0101",
        email: "olena@example.test",
        relation: "sibling",
        notes: "Email: olena@example.test",
        birthDate: "",
        citizenships: [],
      },
      {
        id: "relation-2",
        persistedId: "relation-2",
        relatedPatientId: null,
        name: "Petro O.",
        phone: "+380 44 555 0102",
        email: "",
        relation: "sibling",
        notes: "",
        birthDate: "1984-03-02",
        citizenships: ["UA", "DE"],
      },
    ]);
  });

  it("sends a separate contact's birth date and citizenships, never a linked record's", () => {
    // Client decision 2026-11-02: several citizenships per person.
    const contact = {
      ...makePatientTrustedContactForm("mother"),
      name: "Olga",
      birthDate: " 1984-03-02 ",
      citizenships: ["ua", "DE", "UA"],
    };
    expect(patientTrustedContactIdentityPayload(contact)).toEqual({
      birth_date: "1984-03-02",
      citizenships: ["UA", "DE"],
    });
    expect(patientTrustedContactIdentityPayload({ ...contact, relatedPatientId: "patient-1" })).toEqual({});
  });

  it("keeps multiple filled contacts and drops a fully empty draft", () => {
    expect(patientTrustedContactsToPayload([
      {
        id: "contact-1",
        persistedId: "relation-1",
        relatedPatientId: "patient-sister",
        name: "  Olena  ",
        phone: " +380 44 555 0101 ",
        email: " olena@example.test ",
        relation: "sibling",
        notes: " primary ",
      },
      {
        id: "contact-2",
        persistedId: null,
        relatedPatientId: null,
        name: "Petro",
        phone: "",
        email: "",
        relation: "",
        notes: "",
      },
      {
        id: "contact-empty",
        persistedId: null,
        relatedPatientId: null,
        name: "",
        phone: "",
        email: "",
        relation: "other",
        notes: "",
      },
    ])).toEqual([
      {
        id: "contact-1",
        persistedId: "relation-1",
        relatedPatientId: "patient-sister",
        name: "Olena",
        phone: "+380 44 555 0101",
        email: "olena@example.test",
        relation: "sibling",
        notes: "primary",
      },
      {
        id: "contact-2",
        persistedId: null,
        relatedPatientId: null,
        name: "Petro",
        phone: "",
        email: "",
        relation: "other",
        notes: "",
      },
    ]);
  });
});
