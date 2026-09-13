import { describe, expect, it } from "vitest";

import {
  patientDetailCoreDataPresentation,
  patientDetailResourceItems,
} from "./use-patient-detail-core-data";

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

describe("patientDetailCoreDataPresentation", () => {
  it("keeps the current patient mounted during a background refresh", () => {
    expect(
      patientDetailCoreDataPresentation(
        "patient-1",
        "patient-1",
        true,
        "patient-1:2",
        "patient-1:1",
      ),
    ).toEqual({
      hasCurrentPatientData: true,
      isSettled: false,
      loading: false,
    });
  });

  it("shows the loader instead of stale data when navigating to another patient", () => {
    expect(
      patientDetailCoreDataPresentation(
        "patient-2",
        "patient-1",
        true,
        "patient-2:0",
        "patient-1:1",
      ),
    ).toEqual({
      hasCurrentPatientData: false,
      isSettled: false,
      loading: true,
    });
  });
});
