import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  blankDoctorForm,
  blankProviderForm,
  buildProvidersQuery,
  doctorListDisplayName,
  formatDoctorTitleValue,
  formatWeeklyAvailabilityDisplay,
  formatWeeklyAvailabilityValue,
  parseWeeklyAvailability,
  splitDoctorTitleValue,
  toDoctorPayload,
  toProviderPayload,
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
});

describe("doctor title helpers", () => {
  it("parses and sorts title values from highest to lowest", () => {
    expect(splitDoctorTitleValue("Dr. med. Prof. PD")).toEqual(["Prof.", "PD", "Dr. med."]);
    expect(formatDoctorTitleValue("Dr. Prof.")).toBe("Prof. Dr.");
  });

  it("adds gender salutation only for German doctor lists", () => {
    const doctor = {
      name: "JOHN REMBO",
      title: "Prof. Dr.",
      gender: "male" as const,
    };

    expect(doctorListDisplayName(doctor, "de")).toBe("Herr Prof. Dr. JOHN REMBO");
    expect(doctorListDisplayName(doctor, "ru")).toBe("Prof. Dr. JOHN REMBO");
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
});
