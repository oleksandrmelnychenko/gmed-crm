import { describe, expect, it } from "vitest";
import type { ClinicalNarrative } from "@/pages/patients/data/patient-clinical";
import { narrativeForIntakeSave } from "./lead-wizard.clinical-state";

describe("repeat intake anamnesis", () => {
  const original = {
    id: "old-narrative", case_id: "old-case", anamnese_at: "2025-01-01T10:00:00Z",
    anamnese_aktuelle: "Previous concern", anamnese_vorgeschichte: "Existing history",
    is_active: true,
  } as ClinicalNarrative;

  it("creates a new episode version when the previous anamnesis is edited", () => {
    const result = narrativeForIntakeSave({...original, anamnese_aktuelle: "New concern"}, "new-case");
    expect(result).toMatchObject({id: null, case_id: "new-case", anamnese_aktuelle: "New concern", anamnese_vorgeschichte: "Existing history"});
    expect(result.anamnese_at).not.toBe(original.anamnese_at);
    expect(original.id).toBe("old-narrative");
  });

  it("keeps editing the version already belonging to this episode", () => {
    expect(narrativeForIntakeSave(original, "old-case")).toBe(original);
  });

  it("also preserves unassigned historical anamneses", () => {
    expect(narrativeForIntakeSave({...original, case_id: null}, "new-case")).toMatchObject({id: null, case_id: "new-case"});
  });
});
