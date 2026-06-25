import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  applyDoctorFieldChange,
  applyStaffFieldChange,
  blankDoctorForm,
  blankProviderForm,
  blankServiceForm,
  blankStaffForm,
  buildProviderAttributeValueOptionsQuery,
  buildProvidersQuery,
  composeDoctorDisplayName,
  composeStaffDisplayName,
  doctorIdentityValue,
  doctorListDisplayName,
  doctorToForm,
  existingDoctorLinkOptions,
  formatDoctorTitleValue,
  formatWeeklyAvailabilityDisplay,
  formatWeeklyAvailabilityDisplayItems,
  formatWeeklyAvailabilityValue,
  normalizeAvailabilityEditorIntervals,
  parseWeeklyAvailability,
  providerLoadErrorMessage,
  splitDoctorTitleValue,
  taxonomyAttributeValueOptions,
  taxonomyAttributeValue,
  toDoctorPayload,
  toProviderPayload,
  toServicePayload,
  toStaffPayload,
  updateTaxonomyAttributeValue,
  updateWeeklyAvailabilityIntervalValue,
} from "./list-model";
import type { ProviderPeopleRow } from "./people-types";
import type { ProviderFilters } from "./types";

function paramsFromPath(path: string) {
  return new URL(path, "https://crm.test").searchParams;
}

function providerPeopleDoctorRow(overrides: Partial<ProviderPeopleRow> = {}): ProviderPeopleRow {
  return {
    person_type: "doctor",
    person_id: "doctor-1",
    shared_identity_id: null,
    provider_id: "provider-1",
    provider_name: "Clinic",
    provider_type: "medical",
    name: "Dr. One",
    first_name: null,
    last_name: null,
    display_name: null,
    title: null,
    role_code: null,
    role_label: null,
    gender: "unknown",
    opening_hours: null,
    fachbereich: null,
    specializations: [],
    insurance_providers: [],
    languages: [],
    phone: null,
    email: null,
    contacts: [],
    linked_patients: [],
    department: null,
    status: "active",
    license_number: null,
    licensing_country: null,
    licensing_valid_until: null,
    notes: null,
    counts: {},
    last_interaction_at: null,
    ...overrides,
  };
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

  it("serializes insurance providers as a backend filter", () => {
    const params = paramsFromPath(
      buildProvidersQuery(
        {
          ...DEFAULT_FILTERS,
          activeOnly: "",
          providerType: "medical",
          insuranceProvider: "Techniker Krankenkasse, AXA",
        },
        false,
      ),
    );

    expect(params.get("insurance_provider")).toBe("Techniker Krankenkasse, AXA");
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
      insurance_providers: [],
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
          {
            ...baseProvider,
            id: "provider-4",
            taxonomy_attributes: { cuisine: "Amerikanische, Steak House, Seafood" },
          },
          {
            ...baseProvider,
            id: "provider-5",
            taxonomy_attributes: { cuisine: "Fine Dining. Fruehstueck" },
          },
          {
            ...baseProvider,
            id: "provider-10",
            taxonomy_attributes: { cuisine: "Sushi; Ramen & Barbecue\nSeafood" },
          },
          {
            ...baseProvider,
            id: "provider-6",
            taxonomy_attributes: { cuisine: "Bayerische Kueche/Mediterrane Kueche" },
          },
          {
            ...baseProvider,
            id: "provider-7",
            taxonomy_attributes: { cuisine: "Asiatische Kueche Mediterrane Kueche" },
          },
          { ...baseProvider, id: "provider-8", taxonomy_attributes: { cuisine: "" } },
          { ...baseProvider, id: "provider-9", taxonomy_attributes: { diet: "Halal" } },
        ],
        "cuisine",
      ),
    ).toEqual([
      "Amerikanische",
      "Asiatische Kueche Mediterrane Kueche",
      "Barbecue",
      "Bayerische Kueche",
      "Fine dining",
      "Fruehstueck",
      "Mediterrane Kueche",
      "Ramen",
      "Seafood",
      "Steak House",
      "Sushi",
    ]);
  });
});

describe("providerLoadErrorMessage", () => {
  it("uses the localized fallback instead of leaking raw transport errors", () => {
    expect(providerLoadErrorMessage(new Error("Failed to fetch"), "Ошибка загрузки")).toBe(
      "Ошибка загрузки",
    );
    expect(
      providerLoadErrorMessage(
        new Error("NetworkError when attempting to fetch resource."),
        "Fehler beim Laden",
      ),
    ).toBe("Fehler beim Laden");
    expect(providerLoadErrorMessage(new Error("Failed to fetch"), "")).not.toContain(
      "Failed",
    );
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

  it("sends insurance providers for medical providers", () => {
    const form = {
      ...blankProviderForm("medical"),
      name: "Clinic Versicherungen",
      insuranceProviders: "Techniker Krankenkasse, AXA, Techniker Krankenkasse",
    };

    const payload = toProviderPayload(form, false);

    expect(payload.insurance_providers).toEqual(["Techniker Krankenkasse", "AXA"]);
  });

  it("clears insurance providers for non-medical providers", () => {
    const form = {
      ...blankProviderForm("non_medical"),
      name: "Transfer Service",
      insuranceProviders: "Techniker Krankenkasse",
    };

    const payload = toProviderPayload(form, false);

    expect(payload.provider_type).toBe("non_medical");
    expect(payload.insurance_providers).toEqual([]);
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

  it("sends multiple doctor insurance providers", () => {
    const form = {
      ...blankDoctorForm(),
      name: "Dr. Sofia Weber",
      insuranceProviders: "Techniker Krankenkasse, AXA, AXA",
    };

    const payload = toDoctorPayload(form);

    expect(payload.insurance_providers).toEqual(["Techniker Krankenkasse", "AXA"]);
  });

  it("sends an existing shared doctor identity when linking a doctor to another provider", () => {
    const form = {
      ...blankDoctorForm(),
      name: "Dr. Sofia Weber",
      sharedIdentityId: "11111111-1111-4111-8111-111111111111",
    };

    const payload = toDoctorPayload(form);

    expect(payload.shared_identity_id).toBe("11111111-1111-4111-8111-111111111111");
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

describe("existingDoctorLinkOptions", () => {
  it("deduplicates existing doctors by shared identity and excludes already linked rows", () => {
    const options = existingDoctorLinkOptions(
      [
        providerPeopleDoctorRow({
          person_id: "doctor-a-clinic-1",
          shared_identity_id: "identity-a",
          provider_id: "source-1",
          provider_name: "Source 1",
        }),
        providerPeopleDoctorRow({
          person_id: "doctor-a-clinic-2",
          shared_identity_id: "identity-a",
          provider_id: "source-2",
          provider_name: "Source 2",
        }),
        providerPeopleDoctorRow({
          person_id: "doctor-current",
          shared_identity_id: "identity-current",
          provider_id: "target",
        }),
        providerPeopleDoctorRow({
          person_id: "doctor-linked",
          shared_identity_id: "identity-linked",
          provider_id: "source-3",
        }),
        providerPeopleDoctorRow({
          person_id: "doctor-non-medical",
          shared_identity_id: "identity-non-medical",
          provider_id: "source-4",
          provider_type: "non_medical",
        }),
      ],
      "target",
      new Set(["identity-linked"]),
    );

    expect(options.map(doctorIdentityValue)).toEqual(["identity-a"]);
  });

  it("uses the doctor id when a shared identity is not available yet", () => {
    const row = providerPeopleDoctorRow({
      person_id: "legacy-doctor-id",
      shared_identity_id: null,
    });

    expect(doctorIdentityValue(row)).toBe("legacy-doctor-id");
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
      insurance_providers: [{ id: "ins-1", name: "Techniker Krankenkasse", is_active: true }],
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
    expect(form.insuranceProviders).toBe("Techniker Krankenkasse");
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

describe("staff display names", () => {
  const base = {
    ...blankStaffForm(),
    firstName: "",
    lastName: "",
    displayName: "",
    gender: "unknown" as const,
  };

  it("prefixes Herr/Frau by gender and omits it when unknown", () => {
    expect(composeStaffDisplayName("Max", "Mustermann", "male")).toBe("Herr Max Mustermann");
    expect(composeStaffDisplayName("Anna", "Keller", "female")).toBe("Frau Anna Keller");
    expect(composeStaffDisplayName("Sam", "Doe", "unknown")).toBe("Sam Doe");
  });

  it("returns empty when there is no name part", () => {
    expect(composeStaffDisplayName("", "", "male")).toBe("");
    expect(composeStaffDisplayName("  ", "", "female")).toBe("");
  });

  it("recomposes the staff display name when name parts or gender change", () => {
    let form = applyStaffFieldChange(base, "firstName", "Marta");
    form = applyStaffFieldChange(form, "lastName", "Secretary");
    expect(form.displayName).toBe("Marta Secretary");

    form = applyStaffFieldChange(form, "gender", "female");
    expect(form.displayName).toBe("Frau Marta Secretary");

    form = applyStaffFieldChange(form, "gender", "male");
    expect(form.displayName).toBe("Herr Marta Secretary");
  });

  it("keeps an existing free-form display name when there are no name parts", () => {
    const legacy = { ...base, displayName: "Front Desk" };
    const afterGender = applyStaffFieldChange(legacy, "gender", "female");
    expect(afterGender.displayName).toBe("Front Desk");
  });

  it("sends the gendered staff display name in the payload", () => {
    const payload = toStaffPayload({
      ...base,
      firstName: "Marta",
      lastName: "Secretary",
      gender: "female",
      role: "staff",
    });

    expect(payload.display_name).toBe("Frau Marta Secretary");
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

  it("builds seven read-only availability items and marks unchecked days as closed", () => {
    const items = formatWeeklyAvailabilityDisplayItems("Mo-Di 09:00-18:00", "ru");

    expect(items).toHaveLength(7);
    expect(items.map((item) => item.label)).toEqual([
      "Пн 09:00-18:00",
      "Вт 09:00-18:00",
      "Ср (Закрыто)",
      "Чт (Закрыто)",
      "Пт (Закрыто)",
      "Сб (Закрыто)",
      "Вс (Закрыто)",
    ]);
    expect(items.filter((item) => item.closed).map((item) => item.day)).toEqual([
      "wed",
      "thu",
      "fri",
      "sat",
      "sun",
    ]);
  });

  it("shows every day as closed when no availability was selected", () => {
    expect(formatWeeklyAvailabilityDisplayItems("", "ru").map((item) => item.label)).toEqual([
      "Пн (Закрыто)",
      "Вт (Закрыто)",
      "Ср (Закрыто)",
      "Чт (Закрыто)",
      "Пт (Закрыто)",
      "Сб (Закрыто)",
      "Вс (Закрыто)",
    ]);
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

  it("serializes slot comments as JSON and renders them in the display", () => {
    const value = formatWeeklyAvailabilityValue([
      {
        day: "mon",
        enabled: true,
        intervals: [{ start: "09:00", end: "17:00", comment: "Mittagspause 13-14" }],
      },
    ]);
    // Comments cannot ride in the legacy string, so the encoder switches to JSON.
    expect(value.startsWith("[")).toBe(true);
    expect(formatWeeklyAvailabilityDisplay(value, "ru")).toBe(
      "Пн 09:00-17:00 (Mittagspause 13-14)",
    );
  });

  it("round-trips a comment that itself contains a time range", () => {
    const value = formatWeeklyAvailabilityValue([
      {
        day: "tue",
        enabled: true,
        intervals: [{ start: "08:00", end: "18:00", comment: "Pause 13:00-14:00" }],
      },
    ]);
    const parsed = parseWeeklyAvailability(value);
    const tue = parsed.find((row) => row.day === "tue");
    // The inner "13:00-14:00" must NOT be mis-parsed as a second interval.
    expect(tue?.intervals).toEqual([
      { start: "08:00", end: "18:00", comment: "Pause 13:00-14:00" },
    ]);
  });

  it("keeps the legacy plain-string format when no slot has a comment", () => {
    const value = formatWeeklyAvailabilityValue([
      { day: "mon", enabled: true, intervals: [{ start: "09:00", end: "17:00" }] },
    ]);
    expect(value).toBe("Mon 09:00-17:00");
  });

});
