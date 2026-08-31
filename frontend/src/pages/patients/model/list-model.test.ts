import { describe, expect, it } from "vitest";

import {
  collectPatientInsuranceTypeOptions,
  filterPatientsByInsuranceType,
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
        related_name: "Olena Onboarding",
        relation_type: "Sister",
        is_emergency_contact: true,
        phone: "+380 44 555 0101",
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
        name: "Olena Onboarding",
        phone: "+380 44 555 0101",
        relation: "sibling",
        notes: "Email: olena@example.test",
      },
      {
        id: "relation-2",
        persistedId: "relation-2",
        name: "Petro O.",
        phone: "+380 44 555 0102",
        relation: "sibling",
        notes: "",
      },
    ]);
  });

  it("keeps multiple filled contacts and drops a fully empty draft", () => {
    expect(patientTrustedContactsToPayload([
      {
        id: "contact-1",
        persistedId: "relation-1",
        name: "  Olena  ",
        phone: " +380 44 555 0101 ",
        relation: "sibling",
        notes: " primary ",
      },
      {
        id: "contact-2",
        persistedId: null,
        name: "Petro",
        phone: "",
        relation: "",
        notes: "",
      },
      {
        id: "contact-empty",
        persistedId: null,
        name: "",
        phone: "",
        relation: "other",
        notes: "",
      },
    ])).toEqual([
      {
        id: "contact-1",
        persistedId: "relation-1",
        name: "Olena",
        phone: "+380 44 555 0101",
        relation: "sibling",
        notes: "primary",
      },
      {
        id: "contact-2",
        persistedId: null,
        name: "Petro",
        phone: "",
        relation: "other",
        notes: "",
      },
    ]);
  });
});
