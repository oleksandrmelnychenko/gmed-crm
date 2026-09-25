import { describe, expect, it } from "vitest";

import {
  isCreateOrderPatientChange,
  resolveCreateOrderSubmitBlock,
  type CreateOrderSubmitGateInput,
} from "./create-order-gate";

const base: CreateOrderSubmitGateInput = {
  patientId: "patient-1",
  requestedAgencyServiceId: "",
  agencyServicesLoaded: true,
  hasPendingAgencyService: false,
  recheck: { requires_recheck: true, can_create_order: true, blocking_reasons: [] },
  recheckLoading: false,
  recheckError: null,
};

describe("resolveCreateOrderSubmitBlock", () => {
  it("allows saving once the re-check passed", () => {
    expect(resolveCreateOrderSubmitBlock(base)).toBeNull();
    expect(
      resolveCreateOrderSubmitBlock({
        ...base,
        recheck: { requires_recheck: false, can_create_order: false, blocking_reasons: [] },
      }),
    ).toBeNull();
  });

  it("leaves the patient-required validation to the submit handler", () => {
    expect(
      resolveCreateOrderSubmitBlock({ ...base, patientId: "", recheck: null }),
    ).toBeNull();
  });

  it("explains a missing or loading re-check", () => {
    expect(
      resolveCreateOrderSubmitBlock({ ...base, recheck: null, recheckLoading: true }),
    ).toEqual({ kind: "recheck_loading" });
    expect(
      resolveCreateOrderSubmitBlock({ ...base, recheck: null, recheckError: "boom" }),
    ).toEqual({ kind: "recheck_unavailable", error: "boom" });
  });

  it("returns the first server blocking reason", () => {
    expect(
      resolveCreateOrderSubmitBlock({
        ...base,
        recheck: {
          requires_recheck: true,
          can_create_order: false,
          blocking_reasons: ["Identity is not verified", "Preferred language is missing"],
        },
      }),
    ).toEqual({ kind: "recheck_blocked", reason: "Identity is not verified" });
  });

  it("checks the requested catalog service first", () => {
    expect(
      resolveCreateOrderSubmitBlock({
        ...base,
        requestedAgencyServiceId: "svc-1",
        agencyServicesLoaded: false,
      }),
    ).toEqual({ kind: "agency_service_loading" });
    expect(
      resolveCreateOrderSubmitBlock({ ...base, requestedAgencyServiceId: "svc-1" }),
    ).toEqual({ kind: "agency_service_unavailable" });
    expect(
      resolveCreateOrderSubmitBlock({
        ...base,
        requestedAgencyServiceId: "svc-1",
        hasPendingAgencyService: true,
      }),
    ).toBeNull();
  });
});

describe("isCreateOrderPatientChange", () => {
  it("treats re-selecting the current patient as no change", () => {
    expect(isCreateOrderPatientChange("patient-1", "patient-1")).toBe(false);
    expect(isCreateOrderPatientChange("patient-1", "patient-2")).toBe(true);
    expect(isCreateOrderPatientChange("patient-1", "")).toBe(true);
  });
});
