import { describe, expect, it } from "vitest";

import {
  CASE_RECORD_SECTION_KEYS,
  CASE_WORKSPACE_SECTIONS,
  normalizeCaseSectionKey,
} from "./sections";

describe("case workspace section registry", () => {
  it("groups sections into episode / record / meta", () => {
    const groups = new Set(CASE_WORKSPACE_SECTIONS.map((section) => section.group));
    expect([...groups].sort()).toEqual(["episode", "meta", "record"]);
  });

  it("keeps the patient-record projections in the record group", () => {
    expect(CASE_RECORD_SECTION_KEYS).toEqual([
      "anamnese",
      "diagnoses",
      "medications",
      "allergies",
      "befunde",
      "procedures",
      "verlauf",
    ]);
  });

  it("normalizes valid keys and defaults unknown ones to overview", () => {
    expect(normalizeCaseSectionKey("symptoms")).toBe("symptoms");
    expect(normalizeCaseSectionKey("befunde")).toBe("befunde");
    expect(normalizeCaseSectionKey(null)).toBe("overview");
    expect(normalizeCaseSectionKey("nonsense")).toBe("overview");
  });

  it("maps retired pre-Phase-4 deep links onto their replacements", () => {
    expect(normalizeCaseSectionKey("preconditions")).toBe("diagnoses");
    expect(normalizeCaseSectionKey("surgeries")).toBe("procedures");
    expect(normalizeCaseSectionKey("vegetative")).toBe("anamnese");
    expect(normalizeCaseSectionKey("impfstatus")).toBe("overview");
  });
});
