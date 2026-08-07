import { describe, expect, it } from "vitest";

import type {
  ClinicalDiagnosis,
  ClinicalNarrative,
} from "@/pages/patients/data/patient-clinical";
import type { SpecializationItem } from "@/pages/providers/model/types";
import {
  collectAttachedClinicalSpecializations,
  clinicalSpecializationFilterAllowsEditing,
  filterClinicalDiagnosisTree,
  filterClinicalNarrative,
  filterClinicalRecords,
  mergeFilteredClinicalNarrative,
  mergeFilteredClinicalRecords,
} from "./clinical-specialization-filter";

const cardio: SpecializationItem = {
  id: "cardio",
  code: "CARD",
  name_en: "Cardiology",
  name_de: "Kardiologie",
  name_ru: "Кардиология",
  is_active: true,
  sort_order: 20,
};
const gastro: SpecializationItem = {
  id: "gastro",
  code: "GAST",
  name_en: "Gastroenterology",
  name_de: "Gastroenterologie",
  name_ru: "Гастроэнтерология",
  is_active: false,
  sort_order: 10,
};

describe("clinical specialization filter", () => {
  it("allows destructive tree editing only in the unfiltered view", () => {
    expect(clinicalSpecializationFilterAllowsEditing(null)).toBe(true);
    expect(clinicalSpecializationFilterAllowsEditing(cardio.id)).toBe(false);
  });
  it("lists only unique specializations actually attached to patient records", () => {
    expect(
      collectAttachedClinicalSpecializations(
        [
          { specialization_ids: [cardio.id] },
          { specializations: [gastro, cardio] },
        ],
        [cardio],
      ).map((item) => item.id),
    ).toEqual([gastro.id, cardio.id]);
  });

  it("shows only records explicitly tagged with the selected specialization", () => {
    const records = [
      { id: "general", specialization_ids: [] },
      { id: "cardio", specialization_ids: [cardio.id] },
      { id: "gastro", specialization_ids: [gastro.id] },
    ];
    expect(filterClinicalRecords(records, cardio.id).map((item) => item.id)).toEqual(["cardio"]);
  });

  it("preserves hidden records when a filtered section is saved", () => {
    const all = [
      { id: "cardio", specialization_ids: [cardio.id], value: "old" },
      { id: "gastro", specialization_ids: [gastro.id], value: "hidden" },
    ];
    const visible = filterClinicalRecords(all, cardio.id);
    const merged = mergeFilteredClinicalRecords(all, visible, [
      { ...visible[0], value: "updated" },
    ]);
    expect(merged).toEqual([
      { id: "cardio", specialization_ids: [cardio.id], value: "updated" },
      { id: "gastro", specialization_ids: [gastro.id], value: "hidden" },
    ]);
  });

  it("keeps non-matching diagnosis ancestors only as context and drops non-matching children", () => {
    const diagnoses = [
      { id: "parent", kind: "main", specialization_ids: [gastro.id] },
      {
        id: "matching-child",
        parent_id: "parent",
        kind: "secondary",
        specialization_ids: [cardio.id],
      },
      {
        id: "other-child",
        parent_id: "parent",
        kind: "secondary",
        specialization_ids: [gastro.id],
      },
    ] as unknown as ClinicalDiagnosis[];
    expect(filterClinicalDiagnosisTree(diagnoses, cardio.id).map((item) => item.id)).toEqual([
      "parent",
      "matching-child",
    ]);
  });

  it("filters narrative specialty blocks but preserves them on save", () => {
    const narrative = {
      id: "narrative",
      specialization_ids: [cardio.id, gastro.id],
      specializations: [
        { ...cardio, narrative_text: "heart", assessment_text: null },
        { ...gastro, narrative_text: "stomach", assessment_text: null },
      ],
    } as ClinicalNarrative;
    const filtered = filterClinicalNarrative(narrative, cardio.id)!;
    expect(filtered.specialization_ids).toEqual([cardio.id]);
    const merged = mergeFilteredClinicalNarrative(
      narrative,
      {
        ...filtered,
        specializations: [{ ...filtered.specializations![0], narrative_text: "updated" }],
      },
      cardio.id,
    );
    expect(merged.specializations?.map((item) => [item.id, item.narrative_text])).toEqual([
      [gastro.id, "stomach"],
      [cardio.id, "updated"],
    ]);
  });
});
