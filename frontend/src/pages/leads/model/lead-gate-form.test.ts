import { describe, expect, it } from "vitest";

import { leadGateFormErrors } from "./lead-gate-form";
import type { LeadGateForm } from "./types";

const tx = (ru: string) => ru;
const stored: LeadGateForm = {
  email: "olga@example.com",
  phone: "12",
  country: "DE",
  primaryLanguage: "ru",
  dateOfBirth: "1980-02-03",
  legalSex: "female",
  complianceStatus: "pending",
  consentHealthcare: false,
  consentPrivacyPractices: false,
  notes: "",
};

describe("leadGateFormErrors", () => {
  it("accepts the stored values, even an older unusable phone", () => {
    expect(leadGateFormErrors(stored, stored, "2026-10-22", tx)).toEqual({});
  });

  it("refuses a changed unusable e-mail or phone at its field", () => {
    const errors = leadGateFormErrors({ ...stored, email: "olga@", phone: "abc" }, stored, "2026-10-22", tx);
    expect(Object.keys(errors).sort()).toEqual(["email", "phone"]);
  });

  it("refuses a date of birth in the future or before 1900", () => {
    expect(leadGateFormErrors({ ...stored, dateOfBirth: "2026-10-23" }, stored, "2026-10-22", tx).dateOfBirth).toBeTruthy();
    expect(leadGateFormErrors({ ...stored, dateOfBirth: "1899-12-31" }, stored, "2026-10-22", tx).dateOfBirth).toBeTruthy();
    expect(leadGateFormErrors({ ...stored, dateOfBirth: "" }, stored, "2026-10-22", tx)).toEqual({});
  });
});
