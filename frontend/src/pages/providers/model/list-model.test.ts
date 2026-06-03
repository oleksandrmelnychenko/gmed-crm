import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  availabilityMaxStartForEnd,
  availabilityMinEndForStart,
  blankDoctorForm,
  blankProviderForm,
  blankServiceForm,
  buildProvidersQuery,
  doctorListDisplayName,
  formatDoctorTitleValue,
  formatWeeklyAvailabilityDisplay,
  formatWeeklyAvailabilityValue,
  normalizeAvailabilityEditorIntervals,
  parseWeeklyAvailability,
  splitDoctorTitleValue,
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
  it("serializes multiple specializations as the specializations CSV filter", () => {
    const filters: ProviderFilters = {
      ...DEFAULT_FILTERS,
      activeOnly: "",
      specializations: "cardiology,neurology",
    };

    const params = paramsFromPath(buildProvidersQuery(filters, false));

    expect(params.get("specializations")).toBe("cardiology,neurology");
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
});

describe("doctor title helpers", () => {
  it("parses and sorts title values from highest to lowest", () => {
    expect(splitDoctorTitleValue("Dr. med. Prof. PD")).toEqual(["Prof.", "PD", "Dr. med."]);
    expect(splitDoctorTitleValue("Priv.-Doz. Dr. med.")).toEqual(["Priv.-Doz.", "Dr. med."]);
    expect(formatDoctorTitleValue("Dr. Prof.")).toBe("Prof. Dr.");
  });

  it("adds Herr/Frau salutation only for German doctor lists", () => {
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

    expect(doctorListDisplayName(maleDoctor, "de")).toBe("Herr Prof. Dr. JOHN REMBO");
    expect(doctorListDisplayName(femaleDoctor, "de")).toBe("Frau Priv.-Doz. Dr. med. ANNA KELLER");
    expect(doctorListDisplayName(maleDoctor, "ru")).toBe("Prof. Dr. JOHN REMBO");
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

  it("pads incomplete minute input instead of falling back to a one-minute interval", () => {
    expect(normalizeAvailabilityEditorIntervals([{ start: "9:0", end: "22:0" }])).toEqual([
      { start: "09:00", end: "22:00" },
    ]);
    expect(normalizeAvailabilityEditorIntervals([{ start: "09:00", end: "22:0" }])).toEqual([
      { start: "09:00", end: "22:00" },
    ]);
    expect(formatWeeklyAvailabilityDisplay("Mo 9:0-22:0", "de")).toBe("Mo 09:00-22:00");
  });

  it("commits picker interval edits into the serialized opening hours immediately", () => {
    expect(
      updateWeeklyAvailabilityIntervalValue("Mo 09:00-17:00", "mon", 0, "end", "22:00"),
    ).toBe("Mon 09:00-22:00");
  });

  it("supports full-day availability expressed as 00:00-00:00", () => {
    expect(normalizeAvailabilityEditorIntervals([{ start: "00:00", end: "00:00" }])).toEqual([
      { start: "00:00", end: "00:00" },
    ]);
    expect(availabilityMaxStartForEnd("00:00")).toBe("23:59");
    expect(availabilityMinEndForStart("23:59")).toBe("00:00");
    expect(formatWeeklyAvailabilityDisplay("Mo 00:00-00:00", "de")).toBe("Mo 00:00-24:00");
  });

});
