import { describe, expect, it } from "vitest";

import {
  patientClinicalHref,
  resolveLegacyCasesLocation,
} from "./legacy-cases-redirect";

describe("legacy cases routing", () => {
  it("redirects patient-scoped list links to the clinical profile", () => {
    expect(resolveLegacyCasesLocation(undefined, "?patient=patient-1")).toEqual({
      kind: "redirect",
      href: "/patients/patient-1?tab=clinical",
    });
  });

  it("looks up the patient for legacy case detail links", () => {
    expect(resolveLegacyCasesLocation("case-1", "")).toEqual({
      kind: "lookup",
      caseId: "case-1",
    });
    expect(resolveLegacyCasesLocation(undefined, "?case=case-2")).toEqual({
      kind: "lookup",
      caseId: "case-2",
    });
  });

  it("falls back to the patient list when no context is available", () => {
    expect(resolveLegacyCasesLocation(undefined, "")).toEqual({
      kind: "redirect",
      href: "/patients",
    });
  });

  it("encodes patient identifiers", () => {
    expect(patientClinicalHref("patient / 1")).toBe(
      "/patients/patient%20%2F%201?tab=clinical",
    );
  });
});
