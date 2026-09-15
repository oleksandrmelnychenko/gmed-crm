import { describe, expect, it } from "vitest";

import type { AllDoctorOption } from "@/pages/patients/data/patient-clinical";

import { doctorsForProviderBranch, providerBranchDepths } from "./provider-doctor-selection";

const providers = [
  { id: "group", name: "Medical Group", parent_provider_id: null },
  { id: "clinic", name: "Clinic", parent_provider_id: "group" },
  { id: "department", name: "Urology", parent_provider_id: "clinic" },
  { id: "other", name: "Other Clinic", parent_provider_id: null },
];

function doctor(overrides: Partial<AllDoctorOption> = {}): AllDoctorOption {
  return {
    id: "doctor-1",
    name: "Dr. One",
    title: null,
    fachbereich: null,
    provider_id: "clinic",
    provider_name: "Clinic",
    provider_links: [{ id: "clinic", name: "Clinic" }],
    ...overrides,
  };
}

describe("provider doctor branch selection", () => {
  it("collects descendants recursively regardless of provider ordering", () => {
    expect(Array.from(providerBranchDepths([...providers].reverse(), "group"))).toEqual([
      ["group", 0],
      ["clinic", 1],
      ["department", 2],
    ]);
  });

  it("shows doctors from every child and selects the doctor's direct provider", () => {
    const options = doctorsForProviderBranch(providers, [
      doctor(),
      doctor({
        id: "doctor-2",
        name: "Dr. Two",
        provider_id: "department",
        provider_name: "Urology",
        provider_links: [{ id: "department", name: "Urology" }],
      }),
      doctor({
        id: "doctor-3",
        name: "Dr. Outside",
        provider_id: "other",
        provider_name: "Other Clinic",
        provider_links: [{ id: "other", name: "Other Clinic" }],
      }),
    ], "group");

    expect(options.map((option) => [
      option.id,
      option.selected_provider_id,
      option.selected_provider_name,
    ])).toEqual([
      ["doctor-1", "clinic", "Clinic"],
      ["doctor-2", "department", "Urology"],
    ]);
  });

  it("prefers the deepest child link when a doctor is linked at several levels", () => {
    const [option] = doctorsForProviderBranch(providers, [doctor({
      provider_id: "group",
      provider_name: "Medical Group, Clinic",
      provider_links: [
        { id: "group", name: "Medical Group" },
        { id: "clinic", name: "Clinic" },
      ],
    })], "group");

    expect(option.selected_provider_id).toBe("clinic");
  });
});
