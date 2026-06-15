import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  applyDoctorFieldChange,
  blankDoctorForm,
  blankProviderForm,
  blankServiceForm,
  buildProviderAttributeValueOptionsQuery,
  buildProvidersQuery,
  composeDoctorDisplayName,
  doctorListDisplayName,
  doctorToForm,
  formatDoctorTitleValue,
  formatWeeklyAvailabilityDisplay,
  formatWeeklyAvailabilityValue,
  normalizeAvailabilityEditorIntervals,
  parseWeeklyAvailability,
  splitDoctorTitleValue,
  taxonomyAttributeValueOptions,
  taxonomyAttributeValue,
  toDoctorPayload,
  toProviderPayload,
  toServicePayload,
  updateTaxonomyAttributeValue,
  updateWeeklyAvailabilityIntervalValue,
} from "./list-model";
import type { ProviderFilters } from "./types";

function paramsFromPath(path: string) {
  return new URL(path, "https://crm.test").searchParams;
}

describe("buildProvidersQuery", () => {
  it("serializes provider activity filters as active, all, and inactive-only states", () => {
    expect(
      paramsFromPath(buildProvidersQuery({ ...DEFAULT_FILTERS, activeOnly: "true" }, false)).get(
        "active_only",
      ),
    ).toBe("true");

    const allParams = paramsFromPath(
      buildProvidersQuery({ ...DEFAULT_FILTERS, activeOnly: "" }, false),
    );
    expect(allParams.get("active_only")).toBe("false");
    expect(allParams.get("is_active")).toBeNull();

    const inactiveParams = paramsFromPath(
      buildProvidersQuery({ ...DEFAULT_FILTERS, activeOnly: "false" }, false),
    );
    expect(inactiveParams.get("active_only")).toBeNull();
    expect(inactiveParams.get("is_active")).toBe("false");
  });

  it("serializes multiple specializations as the specializations CSV filter", () => {
    const filters: ProviderFilters = {
      ...DEFAULT_FILTERS,
      activeOnly: "",
      specializations: "cardiology,neurology",
    };

    const params = paramsFromPath(buildProvidersQuery(filters, false));

    expect(params.get("specializations")).toBe("cardiology,neurology");
  });

  it("serializes provider category filters to the backend taxonomy key", () => {
    const filters: ProviderFilters = {
      ...DEFAULT_FILTERS,
      activeOnly: "",
      providerType: "non_medical",
      taxonomyNodeId: "0f5ac3c1-0000-4000-9000-000000000002",
    };

    const params = paramsFromPath(buildProvidersQuery(filters, false));

    expect(params.get("provider_type")).toBe("non_medical");
    expect(params.get("taxonomy_node_id")).toBe("0f5ac3c1-0000-4000-9000-000000000002");
  });

  it("builds attribute option queries without the currently selected attribute value", () => {
    const filters: ProviderFilters = {
      ...DEFAULT_FILTERS,
      activeOnly: "",
      providerType: "non_medical",
      taxonomyNodeId: "restaurants",
      taxonomyAttributeKey: "cuisine",
      taxonomyAttributeValue: "Steak House",
    };

    const params = paramsFromPath(buildProviderAttributeValueOptionsQuery(filters, false));

    expect(params.get("provider_type")).toBe("non_medical");
    expect(params.get("taxonomy_node_id")).toBe("restaurants");
    expect(params.get("taxonomy_attribute_key")).toBe("cuisine");
    expect(params.get("taxonomy_attribute_value")).toBeNull();
  });
});

describe("taxonomyAttributeValueOptions", () => {
  it("builds unique existing filter choices for provider taxonomy attributes", () => {
    const baseProvider = {
      id: "provider-1",
      name: "Restaurant",
      provider_type: "non_medical" as const,
      legal_name: null,
      tax_id: null,
      address_city: null,
      address_country: null,
      fachbereich: null,
      phone: null,
      email: null,
      opening_hours: null,
      parent_provider_id: null,
      parent_provider_name: null,
      organization_level: "organization" as const,
      taxonomy_attributes: {},
      specializations: [],
      is_active: true,
      has_contract: false,
      doctor_count: 0,
      patient_count: 0,
      appointment_count: 0,
      service_count: 0,
      concierge_service_count: 0,
      open_concierge_service_count: 0,
      rating_count: 0,
      avg_rating: null,
      last_interaction_at: null,
      created_at: "2026-01-01T00:00:00Z",
    };

    expect(
      taxonomyAttributeValueOptions(
        [
          { ...baseProvider, id: "provider-1", taxonomy_attributes: { cuisine: "Steak House" } },
          { ...baseProvider, id: "provider-2", taxonomy_attributes: { cuisine: "Fine dining" } },
          { ...baseProvider, id: "provider-3", taxonomy_attributes: { cuisine: " steak house " } },
          { ...baseProvider, id: "provider-4", taxonomy_attributes: { cuisine: "" } },
          { ...baseProvider, id: "provider-5", taxonomy_attributes: { diet: "Halal" } },
        ],
        "cuisine",
      ),
    ).toEqual(["Fine dining", "Steak House"]);
  });
});

describe("toProviderPayload", () => {
  it("sends multiple provider specializations", () => {
    const form = {
      ...blankProviderForm("medical"),
      name: "Clinic Rechts der Isar",
      specializations: "cardiology, neurology, oncology",
      openingHours: "Mo-Fr 08:00-17:00",
    };

    const payload = toProviderPayload(form, false);

    expect(payload.specializations).toEqual(["cardiology", "neurology", "oncology"]);
    expect(payload.opening_hours).toBe("Mo-Fr 08:00-17:00");
  });

  it("sends provider country and primary phone/email from structured contacts", () => {
    const form = {
      ...blankProviderForm("medical"),
      name: "Clinic With Contacts",
      addressCountry: "Germany",
      contacts: [
        {
          id: "phone-1",
          contactKind: "phone",
          contactType: "work",
          label: "Reception",
          department: "",
          value: "+49 30 1000",
          isPrimary: true,
          notes: "",
        },
        {
          id: "email-1",
          contactKind: "email",
          contactType: "department",
          label: "Admissions",
          department: "Admissions",
          value: "admissions@clinic.example",
          isPrimary: true,
          notes: "",
        },
      ],
    };

    const payload = toProviderPayload(form, false);

    expect(payload.address_country).toBe("Germany");
    expect(payload.phone).toBe("+49 30 1000");
    expect(payload.email).toBe("admissions@clinic.example");
    expect(payload.contacts).toEqual([
      {
        contact_kind: "phone",
        contact_type: "work",
        label: "Reception",
        department: null,
        value: "+49 30 1000",
        is_primary: true,
        notes: null,
      },
      {
        contact_kind: "email",
        contact_type: "department",
        label: "Admissions",
        department: "Admissions",
        value: "admissions@clinic.example",
        is_primary: true,
        notes: null,
      },
    ]);
  });
});

describe("toDoctorPayload", () => {
  it("keeps title, role_code, and role_label in separate payload fields", () => {
    const form = {
      ...blankDoctorForm(),
      name: "Dr. Anna Keller",
      title: "Prof. Dr.",
      roleCode: "other",
      roleLabel: "Center lead",
      subrole: "Stellvertretender Klinikdirektor",
    } as const;

    const payload = toDoctorPayload(form);

    expect(payload.title).toBe("Prof. Dr.");
    expect(payload.role_code).toBe("other");
    expect(payload.role_label).toBe("Center lead");
    expect(payload.subrole).toBe("Stellvertretender Klinikdirektor");
    expect(payload.title).not.toBe(payload.role_code);
    expect(payload.title).not.toBe(payload.role_label);
  });

  it("does not leak role labels for coded doctor roles", () => {
    const form = {
      ...blankDoctorForm(),
      name: "Dr. Max Braun",
      title: "Priv.-Doz.",
      roleCode: "facharzt",
      roleLabel: "Should not be sent",
    } as const;

    const payload = toDoctorPayload(form);

    expect(payload.title).toBe("Priv.-Doz.");
    expect(payload.role_code).toBe("facharzt");
    expect(payload.role_label).toBeNull();
  });

  it("sends multiple doctor specializations", () => {
    const form = {
      ...blankDoctorForm(),
      name: "Dr. Sofia Weber",
      fachbereich: "internal medicine",
      specializations: "cardiology, electrophysiology, intensive care",
    };

    const payload = toDoctorPayload(form);

    expect(payload.specializations).toEqual(["cardiology", "electrophysiology", "intensive care"]);
  });

  it("sorts multiple doctor titles before sending the payload", () => {
    const form = {
      ...blankDoctorForm(),
      name: "John Rembo",
      title: "Dr. med. Prof.",
    };

    const payload = toDoctorPayload(form);

    expect(payload.title).toBe("Prof. Dr. med.");
  });

  it("keeps Privatdozent title combinations before sending the payload", () => {
    const form = {
      ...blankDoctorForm(),
      name: "Anna Keller",
      title: "Dr. med. Priv.-Doz.",
    };

    const payload = toDoctorPayload(form);

    expect(payload.title).toBe("Priv.-Doz. Dr. med.");
  });

  it("sends the website link and narrow specialization (Schwerpunkt)", () => {
    const form = {
      ...blankDoctorForm(),
      firstName: "Max",
      lastName: "Mustermann",
      gender: "male" as const,
      fachbereich: "internal medicine",
      schwerpunkt: "interventional cardiology",
      website: "https://praxis-mustermann.de",
    };

    const payload = toDoctorPayload(form);

    expect(payload.schwerpunkt).toBe("interventional cardiology");
    expect(payload.website).toBe("https://praxis-mustermann.de");
  });

  it("sends blank website and Schwerpunkt as null (cleared), not as empty strings", () => {
    const payload = toDoctorPayload({ ...blankDoctorForm(), firstName: "Max", lastName: "Braun" });

    expect(payload.website).toBeNull();
    expect(payload.schwerpunkt).toBeNull();
  });
});

describe("doctorToForm", () => {
  it("hydrates the website link and narrow specialization from the API doctor", () => {
    const form = doctorToForm({
      id: "doc-1",
      provider_id: "prov-1",
      name: "Herr Max Mustermann",
      first_name: "Max",
      last_name: "Mustermann",
      display_name: "Herr Max Mustermann",
      title: null,
      fachbereich: "Innere Medizin",
      specializations: [],
      languages: [],
      phone: null,
      email: null,
      contacts: [],
      role_code: null,
      role_label: null,
      subrole: null,
      website: "https://praxis-mustermann.de",
      schwerpunkt: "Interventionelle Kardiologie",
      gender: "male",
      opening_hours: null,
      relationships: [],
      license_number: null,
      licensing_country: null,
      licensing_valid_until: null,
      notes: null,
      patient_count: 0,
      appointment_count: 0,
      created_at: "2026-01-01T00:00:00Z",
    });

    expect(form.website).toBe("https://praxis-mustermann.de");
    expect(form.schwerpunkt).toBe("Interventionelle Kardiologie");
  });
});

describe("doctor title helpers", () => {
  it("parses and sorts title values from highest to lowest", () => {
    expect(splitDoctorTitleValue("Dr. med. Prof. PD")).toEqual(["Prof.", "PD", "Dr. med."]);
    expect(splitDoctorTitleValue("Priv.-Doz. Dr. med.")).toEqual(["Priv.-Doz.", "Dr. med."]);
    expect(formatDoctorTitleValue("Dr. Prof.")).toBe("Prof. Dr.");
  });

  it("adds the gender-derived Herr/Frau salutation in front of the title", () => {
    const maleDoctor = {
      name: "JOHN REMBO",
      title: "Prof. Dr.",
      gender: "male" as const,
    };
    const femaleDoctor = {
      name: "ANNA KELLER",
      title: "Dr. med. Priv.-Doz.",
      gender: "female" as const,
    };

    // Salutation is shown in every locale, not gated to German.
    expect(doctorListDisplayName(maleDoctor)).toBe("Herr Prof. Dr. JOHN REMBO");
    expect(doctorListDisplayName(femaleDoctor)).toBe("Frau Priv.-Doz. Dr. med. ANNA KELLER");
  });

  it("omits the salutation when gender is unknown", () => {
    expect(
      doctorListDisplayName({ name: "JOHN REMBO", title: "Prof. Dr.", gender: "unknown" }),
    ).toBe("Prof. Dr. JOHN REMBO");
  });

  it("keeps a salutation baked into the name without doubling it", () => {
    const doctor = { name: "Herr Max Mustermann", title: "Dr.", gender: "male" as const };

    // Salutation stays in front, title slots after it, and it is not repeated.
    expect(doctorListDisplayName(doctor)).toBe("Herr Dr. Max Mustermann");
  });
});

describe("composeDoctorDisplayName", () => {
  it("prefixes Herr/Frau by gender and omits it when unknown", () => {
    expect(composeDoctorDisplayName("Max", "Mustermann", "male")).toBe("Herr Max Mustermann");
    expect(composeDoctorDisplayName("Anna", "Keller", "female")).toBe("Frau Anna Keller");
    expect(composeDoctorDisplayName("Sam", "Doe", "unknown")).toBe("Sam Doe");
  });

  it("returns empty when there is no name part (a salutation alone is not a name)", () => {
    expect(composeDoctorDisplayName("", "", "male")).toBe("");
    expect(composeDoctorDisplayName("  ", "", "female")).toBe("");
  });
});

describe("applyDoctorFieldChange", () => {
  const base = { ...blankDoctorForm(), firstName: "", lastName: "", name: "", gender: "unknown" as const };

  it("auto-fills the display name from name parts while it is still auto-managed", () => {
    const afterFirst = applyDoctorFieldChange(base, "firstName", "Max");
    expect(afterFirst.name).toBe("Max");
    const afterLast = applyDoctorFieldChange(afterFirst, "lastName", "Mustermann");
    expect(afterLast.name).toBe("Max Mustermann");
  });

  it("adds and updates the gendered salutation in the display name", () => {
    const withName = applyDoctorFieldChange(
      applyDoctorFieldChange(base, "firstName", "Max"),
      "lastName",
      "Mustermann",
    );
    const male = applyDoctorFieldChange(withName, "gender", "male");
    expect(male.name).toBe("Herr Max Mustermann");
    const female = applyDoctorFieldChange(male, "gender", "female");
    expect(female.name).toBe("Frau Max Mustermann");
  });

  it("always recomposes the read-only display name when name parts change", () => {
    // The field is read-only/derived, so a stray name value is overwritten as
    // soon as a name part changes.
    const withStray = applyDoctorFieldChange(base, "name", "Chief Surgeon");
    const afterFirst = applyDoctorFieldChange(withStray, "firstName", "Max");
    expect(afterFirst.name).toBe("Max");
  });

  it("tracks the display name through char-by-char typing, then adds the salutation", () => {
    // Simulate a real "Новый врач" session: type first name, then last name,
    // then pick the gender — the display name should follow the whole time.
    let form = base;
    for (const value of ["ц", "цу", "цуу", "цууц", "цууцу", "цууцуц"]) {
      form = applyDoctorFieldChange(form, "firstName", value);
    }
    expect(form.name).toBe("цууцуц");
    for (const value of ["ц", "цу", "цуу", "цууц", "цууцу"]) {
      form = applyDoctorFieldChange(form, "lastName", value);
    }
    expect(form.name).toBe("цууцуц цууцу");
    form = applyDoctorFieldChange(form, "gender", "male");
    expect(form.name).toBe("Herr цууцуц цууцу");
  });

  it("recomposes on a later gender change regardless of a prior name value", () => {
    let form = applyDoctorFieldChange(base, "firstName", "цууцуц");
    form = applyDoctorFieldChange(form, "lastName", "цууцу");
    form = applyDoctorFieldChange(form, "name", "цу");
    form = applyDoctorFieldChange(form, "gender", "male");
    expect(form.name).toBe("Herr цууцуц цууцу");
  });

  it("keeps an existing free-form name when there are no parts to compose from", () => {
    const legacy = { ...base, name: "Dr. House" };
    const afterGender = applyDoctorFieldChange(legacy, "gender", "male");
    expect(afterGender.name).toBe("Dr. House");
  });
});

describe("taxonomy attribute drafts", () => {
  it("keeps trailing spaces while editing taxonomy attributes", () => {
    const draft = updateTaxonomyAttributeValue("{}", "cuisine", "Asian ");

    expect(taxonomyAttributeValue(draft, "cuisine")).toBe("Asian ");
    expect(updateTaxonomyAttributeValue(draft, "cuisine", "   ")).toBe("{}");
  });

  it("trims taxonomy attribute strings only when building payloads", () => {
    const form = {
      ...blankServiceForm(),
      serviceName: "Dinner",
      price: "12",
      taxonomyAttributes: updateTaxonomyAttributeValue("{}", "cuisine", "Asian Fusion "),
    };

    expect(toServicePayload(form).taxonomy_attributes).toEqual({ cuisine: "Asian Fusion" });
  });
});

describe("weekly availability helpers", () => {
  it("parses existing compact weekday ranges into a weekly schedule", () => {
    const schedule = parseWeeklyAvailability("Mo-Fr 08:00-17:00");

    expect(schedule.flatMap((day) => (day.enabled ? [day.day] : []))).toEqual([
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
    ]);
    expect(schedule.find((day) => day.day === "mon")?.intervals).toEqual([
      { start: "08:00", end: "17:00" },
    ]);
  });

  it("formats full weekly availability with multiple intervals per day", () => {
    const value = formatWeeklyAvailabilityValue([
      { day: "mon", enabled: true, intervals: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "17:00" }] },
      { day: "tue", enabled: true, intervals: [{ start: "09:00", end: "16:00" }] },
      { day: "wed", enabled: false, intervals: [] },
      { day: "thu", enabled: false, intervals: [] },
      { day: "fri", enabled: false, intervals: [] },
      { day: "sat", enabled: false, intervals: [] },
      { day: "sun", enabled: false, intervals: [] },
    ]);

    expect(value).toBe("Mon 08:00-12:00, 13:00-17:00; Tue 09:00-16:00");
    expect(formatWeeklyAvailabilityDisplay(value, "ru")).toBe(
      "Пн 08:00-12:00, 13:00-17:00; Вт 09:00-16:00",
    );
  });

  it("compacts consecutive days with identical opening hours", () => {
    const value = formatWeeklyAvailabilityValue([
      { day: "mon", enabled: true, intervals: [{ start: "08:00", end: "20:00" }] },
      { day: "tue", enabled: true, intervals: [{ start: "08:00", end: "22:00" }] },
      { day: "wed", enabled: true, intervals: [{ start: "08:00", end: "22:00" }] },
      { day: "thu", enabled: true, intervals: [{ start: "08:00", end: "22:00" }] },
      { day: "fri", enabled: true, intervals: [{ start: "08:00", end: "22:00" }] },
      { day: "sat", enabled: true, intervals: [{ start: "08:00", end: "22:00" }] },
      { day: "sun", enabled: false, intervals: [] },
    ]);

    expect(value).toBe("Mon 08:00-20:00; Tue-Sat 08:00-22:00");
    expect(formatWeeklyAvailabilityDisplay(value, "ru")).toBe(
      "Пн 08:00-20:00; Вт-Сб 08:00-22:00",
    );
  });

  it("keeps midnight as an end-of-day closing time and displays it as 24:00", () => {
    const schedule = parseWeeklyAvailability("Mo 18:00-00:00");

    expect(schedule.find((day) => day.day === "mon")?.intervals).toEqual([
      { start: "18:00", end: "00:00" },
    ]);
    expect(normalizeAvailabilityEditorIntervals([{ start: "18:00", end: "00:00" }])).toEqual([
      { start: "18:00", end: "00:00" },
    ]);
    expect(normalizeAvailabilityEditorIntervals([{ start: "09:00", end: "00:00" }])).toEqual([
      { start: "09:00", end: "00:00" },
    ]);
    expect(formatWeeklyAvailabilityValue(schedule)).toBe("Mon 18:00-00:00");
    expect(formatWeeklyAvailabilityDisplay("Mo 18:00-00:00", "de")).toBe("Mo 18:00-24:00");
  });

  it("keeps the picked time verbatim — no padding, reformatting or validation", () => {
    expect(normalizeAvailabilityEditorIntervals([{ start: "9:0", end: "22:0" }])).toEqual([
      { start: "9:0", end: "22:0" },
    ]);
    expect(normalizeAvailabilityEditorIntervals([{ start: "09:00", end: "22:0" }])).toEqual([
      { start: "09:00", end: "22:0" },
    ]);
    expect(formatWeeklyAvailabilityDisplay("Mo 9:0-22:0", "de")).toBe("Mo 9:0-22:0");
  });

  it("commits picker interval edits into the serialized opening hours immediately", () => {
    expect(
      updateWeeklyAvailabilityIntervalValue("Mo 09:00-17:00", "mon", 0, "end", "22:00"),
    ).toBe("Mon 09:00-22:00");
  });

  it("preserves an end picker edit even when it is earlier than the current start", () => {
    expect(
      updateWeeklyAvailabilityIntervalValue("Mo 08:00-16:00", "mon", 0, "end", "01:00"),
    ).toBe("Mon 08:00-01:00");
  });

  it("preserves a start picker edit even when it is later than the current end", () => {
    expect(
      updateWeeklyAvailabilityIntervalValue("Mo 08:00-16:00", "mon", 0, "start", "18:00"),
    ).toBe("Mon 18:00-16:00");
  });

  it("does not reorder or clamp editor intervals", () => {
    expect(
      normalizeAvailabilityEditorIntervals([
        { start: "18:00", end: "16:00" },
        { start: "09:00", end: "09:00" },
      ]),
    ).toEqual([
      { start: "18:00", end: "16:00" },
      { start: "09:00", end: "09:00" },
    ]);
  });

  it("supports full-day availability expressed as 00:00-00:00", () => {
    expect(normalizeAvailabilityEditorIntervals([{ start: "00:00", end: "00:00" }])).toEqual([
      { start: "00:00", end: "00:00" },
    ]);
    expect(formatWeeklyAvailabilityDisplay("Mo 00:00-00:00", "de")).toBe("Mo 00:00-24:00");
  });

});
