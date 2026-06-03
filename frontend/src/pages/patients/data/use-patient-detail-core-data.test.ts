import { describe, expect, it } from "vitest";

import { patientDetailResourceItems } from "./use-patient-detail-core-data";

describe("patientDetailResourceItems", () => {
  it("normalizes empty new-patient clinical resources to arrays", () => {
    expect(patientDetailResourceItems(undefined)).toEqual([]);
    expect(patientDetailResourceItems(null)).toEqual([]);
    expect(patientDetailResourceItems({ items: null })).toEqual([]);
  });

  it("keeps loaded resource rows intact", () => {
    expect(patientDetailResourceItems({ items: [{ id: "vital-1" }] })).toEqual([
      { id: "vital-1" },
    ]);
  });
});
