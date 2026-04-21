import { describe, expect, it } from "vitest";

import {
  blankPatientForm,
  computeAge,
  parseLanguages,
  patientDisplayName,
  patientPermissions,
  patientToForm,
  toOptional,
  type PatientDetail,
} from "./patients.helpers";

describe("patientPermissions", () => {
  it("ceo has full access", () => {
    const perms = patientPermissions("ceo");
    expect(perms.canViewPage).toBe(true);
    expect(perms.canCreateEdit).toBe(true);
    expect(perms.canViewAssignments).toBe(true);
    expect(perms.canManageAssignments).toBe(true);
  });
  it("interpreter can view but not create", () => {
    const perms = patientPermissions("interpreter");
    expect(perms.canViewPage).toBe(true);
    expect(perms.canCreateEdit).toBe(false);
    expect(perms.canViewAssignments).toBe(true);
    expect(perms.canManageAssignments).toBe(false);
  });
  it("unknown role has no access", () => {
    const perms = patientPermissions("outsider");
    expect(perms.canViewPage).toBe(false);
    expect(perms.canCreateEdit).toBe(false);
  });
  it("undefined role has no access", () => {
    const perms = patientPermissions(undefined);
    expect(perms.canViewPage).toBe(false);
  });
});

describe("toOptional", () => {
  it("returns null for whitespace", () => {
    expect(toOptional("")).toBeNull();
    expect(toOptional("   ")).toBeNull();
  });
  it("trims surrounding whitespace", () => {
    expect(toOptional("  hello  ")).toBe("hello");
  });
});

describe("parseLanguages", () => {
  it("splits by comma and trims", () => {
    expect(parseLanguages("en, de, ru")).toEqual(["en", "de", "ru"]);
  });
  it("filters empty entries", () => {
    expect(parseLanguages("en,,de,")).toEqual(["en", "de"]);
  });
});

describe("computeAge", () => {
  const now = new Date("2026-04-21");
  it("computes age correctly for past year", () => {
    expect(computeAge("1991-05-14", now)).toBe(34);
  });
  it("subtracts one if birthday not yet passed this year", () => {
    expect(computeAge("2000-12-25", now)).toBe(25);
  });
  it("adds full year if birthday already passed", () => {
    expect(computeAge("2000-01-10", now)).toBe(26);
  });
  it("returns null for invalid input", () => {
    expect(computeAge(null, now)).toBeNull();
    expect(computeAge("", now)).toBeNull();
    expect(computeAge("not-a-date", now)).toBeNull();
  });
});

describe("patientDisplayName", () => {
  it("joins title first last", () => {
    expect(patientDisplayName({ title: "Dr.", first_name: "Anna", last_name: "Müller" })).toBe("Dr. Anna Müller");
  });
  it("skips missing parts", () => {
    expect(patientDisplayName({ title: null, first_name: "Anna", last_name: null })).toBe("Anna");
  });
  it("handles all nulls", () => {
    expect(patientDisplayName({ title: null, first_name: null, last_name: null })).toBe("");
  });
});

describe("patientToForm", () => {
  it("round-trips detail fields with null defaults", () => {
    const detail: PatientDetail = {
      id: "1",
      patient_id: "P-0001",
      gender: "female",
      is_active: true,
      created_at: "2026-04-20T12:00:00Z",
      first_name: "Anna",
      last_name: "Müller",
      languages: ["en", "de"],
      functional_labels: ["vip"],
    };
    const form = patientToForm(detail);
    expect(form.firstName).toBe("Anna");
    expect(form.lastName).toBe("Müller");
    expect(form.languages).toBe("en, de");
    expect(form.functionalLabels).toBe("vip");
    expect(form.gender).toBe("female");
    expect(form.email).toBe("");
  });
});

describe("blankPatientForm", () => {
  it("defaults gender to male, other fields empty", () => {
    const f = blankPatientForm();
    expect(f.gender).toBe("male");
    expect(f.firstName).toBe("");
    expect(f.email).toBe("");
  });
});
