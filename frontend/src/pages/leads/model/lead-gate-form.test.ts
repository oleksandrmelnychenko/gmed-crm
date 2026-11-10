import { describe, expect, it } from "vitest";

import { formAfterBackgroundReload, leadGateFormErrors } from "./lead-gate-form";
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
  internalNote: "",
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

describe("formAfterBackgroundReload", () => {
  // QA 2026-11-10, C-F2: a realtime refresh reloaded the open lead and wiped a typed date of birth.
  it("keeps what was typed and not saved when the same lead is loaded again", () => {
    const typed: LeadGateForm = { ...stored, dateOfBirth: "1985-03-14", phone: "+49 30 5550100", internalNote: "Rückruf" };
    expect(formAfterBackgroundReload(typed, stored, { ...stored })).toEqual(typed);
  });

  it("takes a value somebody else stored for a field the person left alone", () => {
    const typed: LeadGateForm = { ...stored, dateOfBirth: "1985-03-14" };
    const reloaded: LeadGateForm = { ...stored, primaryLanguage: "de", consentPrivacyPractices: true };
    expect(formAfterBackgroundReload(typed, stored, reloaded)).toEqual({
      ...reloaded,
      dateOfBirth: "1985-03-14",
    });
  });

  it("is the stored record when nothing was typed", () => {
    const reloaded: LeadGateForm = { ...stored, email: "new@example.com" };
    expect(formAfterBackgroundReload({ ...stored }, stored, reloaded)).toEqual(reloaded);
  });
});
