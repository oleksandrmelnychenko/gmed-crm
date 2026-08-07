import { describe, expect, it } from "vitest";

import type { ClinicalDiagnosis } from "@/pages/patients/data/patient-clinical";
import type { SpecializationItem } from "@/pages/providers/model/types";

import {
  collectClinicalSpecializations,
  collectDiagnosisSpecializations,
  diagnosesForCase,
  diagnosesForSpecialization,
} from "./case-specializations";

const cardiology: SpecializationItem = {
  id: "specialization-cardio",
  code: "cardiology",
  name_en: "Cardiology",
  name_de: "Kardiologie",
  name_ru: "Кардиология",
  is_active: true,
  sort_order: 20,
};

const neurology: SpecializationItem = {
  id: "specialization-neuro",
  code: "neurology",
  name_en: "Neurology",
  name_de: "Neurologie",
  name_ru: "Неврология",
  is_active: true,
  sort_order: 10,
};

function diagnosis(
  id: string,
  caseId: string | null,
  assigned: SpecializationItem[],
): ClinicalDiagnosis {
  return {
    id,
    case_id: caseId,
    label: id,
    specialization_ids: assigned.map((item) => item.id),
    specializations: assigned,
  } as ClinicalDiagnosis;
}

describe("case specialization projections", () => {
  const caseOneDiagnoses = [
    diagnosis("diagnosis-1", "case-1", [cardiology, neurology]),
    diagnosis("diagnosis-2", "case-1", [cardiology]),
  ];
  const allDiagnoses = [
    ...caseOneDiagnoses,
    diagnosis("diagnosis-3", "case-2", [neurology]),
    diagnosis("diagnosis-without-case", null, [cardiology]),
  ];

  it("keeps only patient-owned diagnoses attributed to the open case", () => {
    expect(diagnosesForCase(allDiagnoses, "case-1").map((item) => item.id)).toEqual([
      "diagnosis-1",
      "diagnosis-2",
    ]);
  });

  it("deduplicates and orders the dynamic specialization rail", () => {
    expect(
      collectDiagnosisSpecializations(caseOneDiagnoses).map((item) => item.id),
    ).toEqual(["specialization-neuro", "specialization-cardio"]);
  });

  it("can derive the rail from different patient-owned clinical record types", () => {
    expect(
      collectClinicalSpecializations([
        { specializations: [cardiology] },
        { specializations: [neurology, cardiology] },
      ]).map((item) => item.id),
    ).toEqual(["specialization-neuro", "specialization-cardio"]);
  });

  it("returns every diagnosis assigned to a selected specialization", () => {
    expect(
      diagnosesForSpecialization(
        caseOneDiagnoses,
        "specialization-cardio",
      ).map((item) => item.id),
    ).toEqual(["diagnosis-1", "diagnosis-2"]);
  });
});
