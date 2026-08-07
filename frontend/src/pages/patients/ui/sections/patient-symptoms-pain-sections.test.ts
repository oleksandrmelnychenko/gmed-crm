import { describe, expect, it } from "vitest";

import { normalizePatientPainNumber } from "./patient-symptoms-pain-sections";

describe("patient symptoms and pain sections", () => {
  it("normalizes localized NRS values without case context", () => {
    expect(normalizePatientPainNumber("7,5")).toBe(7.5);
    expect(normalizePatientPainNumber(4)).toBe(4);
    expect(normalizePatientPainNumber("")).toBeNull();
    expect(normalizePatientPainNumber("invalid")).toBeNull();
  });
});
