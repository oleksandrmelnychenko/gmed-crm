import { describe, expect, it } from "vitest";

import {
  DEFAULT_FILTERS,
  blankDoctorForm,
  blankProviderForm,
  buildProvidersQuery,
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
    };

    const payload = toProviderPayload(form, false);

    expect(payload.specializations).toEqual(["cardiology", "neurology", "oncology"]);
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
});
