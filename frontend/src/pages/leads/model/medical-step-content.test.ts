import { describe, expect, it } from "vitest";

import { medicalStepHasContent, type MedicalStepContent } from "./medical-step-content";

const empty: MedicalStepContent = {
  referrer: "",
  concern: "  ",
  anamnese: "",
  narrative: { anamnese_aktuelle: "", beurteilung: null, is_active: true, id: "n1", specialization_ids: [] },
  diagnoses: [],
  medications: [],
  allergies: [],
  caves: [],
  hasMedicalRecords: false,
  medicalDocumentCount: 0,
};

describe("medicalStepHasContent", () => {
  it("is false for an empty tab (no tick)", () => {
    expect(medicalStepHasContent(empty)).toBe(false);
    expect(medicalStepHasContent({ ...empty, narrative: null })).toBe(false);
  });

  it("is true once any field of the tab is filled", () => {
    expect(medicalStepHasContent({ ...empty, referrer: "Dr. Weber" })).toBe(true);
    expect(medicalStepHasContent({ ...empty, concern: "Knieschmerzen" })).toBe(true);
    expect(medicalStepHasContent({ ...empty, narrative: { anamnese_familie: "Diabetes" } })).toBe(true);
    expect(medicalStepHasContent({ ...empty, narrative: { specialization_ids: ["s1"] } })).toBe(true);
    expect(medicalStepHasContent({ ...empty, diagnoses: [{}] })).toBe(true);
    expect(medicalStepHasContent({ ...empty, caves: [{}] })).toBe(true);
    expect(medicalStepHasContent({ ...empty, hasMedicalRecords: true })).toBe(true);
    expect(medicalStepHasContent({ ...empty, medicalDocumentCount: 1 })).toBe(true);
  });
});
