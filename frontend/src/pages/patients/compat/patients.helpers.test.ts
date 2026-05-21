import { describe, expect, it } from "vitest";

import {
  blankPatientForm,
  buildPatientsPath,
  computeAge,
  parseLanguages,
  patientContactFormsToPayload,
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

describe("buildPatientsPath", () => {
  it("keeps active-only as the default query", () => {
    expect(buildPatientsPath({ search: "", activeOnly: "true", providerId: "", doctorId: "" }))
      .toBe("/patients?active_only=true");
  });

  it("sends active_only=false for all patients", () => {
    expect(buildPatientsPath({ search: "", activeOnly: "", providerId: "", doctorId: "" }))
      .toBe("/patients?active_only=false");
  });

  it("sends inactive-only explicitly", () => {
    expect(buildPatientsPath({ search: "", activeOnly: "false", providerId: "", doctorId: "" }))
      .toBe("/patients?active_only=false");
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

  it("hydrates multiple contacts from patient detail", () => {
    const detail: PatientDetail = {
      id: "1",
      patient_id: "P-0001",
      gender: "female",
      is_active: true,
      created_at: "2026-04-20T12:00:00Z",
      first_name: "Anna",
      last_name: "Müller",
      contacts: [
        {
          id: "phone-1",
          contact_kind: "phone",
          contact_type: "private",
          value: "+49 30 111",
          is_primary: true,
          notes: null,
        },
        {
          id: "email-1",
          contact_kind: "email",
          contact_type: "work",
          value: "anna@example.test",
          is_primary: true,
          notes: "Assistant monitors inbox",
        },
      ],
    };

    const form = patientToForm(detail);

    expect(form.contacts).toEqual([
      {
        id: "phone-1",
        contactKind: "phone",
        contactType: "private",
        value: "+49 30 111",
        isPrimary: true,
        notes: "",
      },
      {
        id: "email-1",
        contactKind: "email",
        contactType: "work",
        value: "anna@example.test",
        isPrimary: true,
        notes: "Assistant monitors inbox",
      },
    ]);
  });
});

describe("patientContactFormsToPayload", () => {
  it("serializes multiple contacts and derives legacy primary fields", () => {
    const payload = patientContactFormsToPayload([
      {
        id: "phone-1",
        contactKind: "phone",
        contactType: "private",
        value: "+49 30 111",
        isPrimary: false,
        notes: "",
      },
      {
        id: "phone-2",
        contactKind: "phone",
        contactType: "work",
        value: "+49 30 222",
        isPrimary: true,
        notes: "Clinic hours",
      },
      {
        id: "email-1",
        contactKind: "email",
        contactType: "private",
        value: "anna@example.test",
        isPrimary: true,
        notes: "",
      },
    ]);

    expect(payload.phonePrimary).toBe("+49 30 222");
    expect(payload.phoneSecondary).toBe("+49 30 111");
    expect(payload.email).toBe("anna@example.test");
    expect(payload.contacts).toEqual([
      {
        contact_kind: "phone",
        contact_type: "private",
        value: "+49 30 111",
        is_primary: false,
        notes: null,
      },
      {
        contact_kind: "phone",
        contact_type: "work",
        value: "+49 30 222",
        is_primary: true,
        notes: "Clinic hours",
      },
      {
        contact_kind: "email",
        contact_type: "private",
        value: "anna@example.test",
        is_primary: true,
        notes: null,
      },
    ]);
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
