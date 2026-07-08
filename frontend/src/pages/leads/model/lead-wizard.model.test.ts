import { describe, expect, it } from "vitest";

import type { LeadDetail } from "@/lib/api/types";

import {
  canConvert,
  completedSteps,
  draftFromLead,
  isMinor,
  nextStep,
  orderNeedsDescription,
  prevStep,
  resumeStep,
  stepIsComplete,
  wizardUpdatePayload,
  type WizardDraft,
} from "./lead-wizard.model";

function lead(overrides: Partial<LeadDetail> = {}): LeadDetail {
  return {
    id: "l1",
    first_name: "Anna",
    last_name: "Muster",
    date_of_birth: "1990-05-01",
    legal_sex: "female",
    email: "anna@example.com",
    phone: "",
    street_address: "Hauptstr. 1",
    city: "Berlin",
    zip_code: "10115",
    primary_language: "de",
    needs_interpreter: false,
    primary_concern_text: "Knee pain",
    additional_concerns: "",
    selected_program: "",
    services: ["surgery"],
    requested_specialties: ["orthopedics"],
    wizard_state: { step: "eligibility" },
    ...overrides,
  } as unknown as LeadDetail;
}

function emptyDraft(): WizardDraft {
  return {
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    legalSex: "",
    email: "",
    phone: "",
    streetAddress: "",
    city: "",
    zipCode: "",
    primaryLanguage: "",
    needsInterpreter: false,
    primaryConcernText: "",
    additionalConcerns: "",
    selectedProgram: "",
    services: [],
    requestedSpecialties: [],
  };
}

describe("draftFromLead", () => {
  it("maps snake_case lead fields to the camelCase draft", () => {
    const draft = draftFromLead(lead());
    expect(draft.firstName).toBe("Anna");
    expect(draft.dateOfBirth).toBe("1990-05-01");
    expect(draft.legalSex).toBe("female");
    expect(draft.services).toEqual(["surgery"]);
    expect(draft.requestedSpecialties).toEqual(["orthopedics"]);
  });

  it("defaults nullable fields", () => {
    const draft = draftFromLead(
      lead({ date_of_birth: null, legal_sex: null, needs_interpreter: null, requested_specialties: [] }),
    );
    expect(draft.dateOfBirth).toBe("");
    expect(draft.legalSex).toBe("");
    expect(draft.needsInterpreter).toBe(false);
    expect(draft.requestedSpecialties).toEqual([]);
  });
});

describe("isMinor", () => {
  const today = new Date("2026-07-08");
  it("flags an under-18 date of birth", () => {
    expect(isMinor("2010-01-01", today)).toBe(true);
  });
  it("does not flag an adult", () => {
    expect(isMinor("1990-05-01", today)).toBe(false);
  });
  it("treats the 18th birthday as an adult", () => {
    expect(isMinor("2008-07-08", today)).toBe(false);
    expect(isMinor("2008-07-09", today)).toBe(true);
  });
  it("returns false for empty or invalid input", () => {
    expect(isMinor("", today)).toBe(false);
    expect(isMinor("not-a-date", today)).toBe(false);
  });
});

describe("stepIsComplete", () => {
  it("identity needs name, dob, legal sex and a contact", () => {
    const draft = draftFromLead(lead());
    expect(stepIsComplete("identity", draft)).toBe(true);
    expect(stepIsComplete("identity", { ...draft, email: "", phone: "" })).toBe(false);
    expect(stepIsComplete("identity", { ...draft, legalSex: "" })).toBe(false);
  });
  it("eligibility needs a primary concern", () => {
    expect(stepIsComplete("eligibility", { ...emptyDraft(), primaryConcernText: "x" })).toBe(true);
    expect(stepIsComplete("eligibility", emptyDraft())).toBe(false);
  });
  it("specialties needs at least one requested specialty", () => {
    expect(stepIsComplete("specialties", { ...emptyDraft(), requestedSpecialties: ["ortho"] })).toBe(true);
    expect(stepIsComplete("specialties", emptyDraft())).toBe(false);
  });
});

describe("canConvert", () => {
  it("requires dob + valid legal sex + a contact, but not compliance", () => {
    expect(canConvert(draftFromLead(lead()))).toBe(true);
    expect(canConvert({ ...draftFromLead(lead()), dateOfBirth: "" })).toBe(false);
    expect(canConvert({ ...draftFromLead(lead()), email: "", phone: "" })).toBe(false);
    expect(canConvert({ ...draftFromLead(lead()), legalSex: "" })).toBe(false);
  });
});

describe("wizardUpdatePayload", () => {
  it("always includes requested_specialties and the wizard_state resume marker", () => {
    const payload = wizardUpdatePayload(draftFromLead(lead()), "eligibility");
    expect(payload.requested_specialties).toEqual(["orthopedics"]);
    expect(payload.wizard_state).toEqual({ step: "eligibility", completed: completedSteps(draftFromLead(lead())) });
  });
  it("omits empty legal sex and name so the backend does not reject them", () => {
    const payload = wizardUpdatePayload(emptyDraft(), "identity");
    expect(payload).not.toHaveProperty("legal_sex");
    expect(payload).not.toHaveProperty("first_name");
    expect(payload).not.toHaveProperty("date_of_birth");
    // free-text/array fields are still present so clearing works
    expect(payload).toHaveProperty("primary_concern_text", "");
    expect(payload).toHaveProperty("services");
  });
});

describe("orderNeedsDescription", () => {
  it("folds the concern and requested specialists into the order need", () => {
    const draft = draftFromLead(
      lead({
        primary_concern_text: "Knee pain",
        additional_concerns: "Also back",
        requested_specialties: ["orthopedics", "surgery"],
      }),
    );
    const text = orderNeedsDescription(draft);
    expect(text).toContain("Knee pain");
    expect(text).toContain("Also back");
    expect(text).toContain("Fachrichtungen: orthopedics, surgery");
  });
  it("is empty when nothing was captured", () => {
    expect(orderNeedsDescription(emptyDraft())).toBe("");
  });
});

describe("navigation + resume", () => {
  it("steps forward and back within Phase A", () => {
    expect(nextStep("identity")).toBe("eligibility");
    expect(nextStep("specialties")).toBeNull();
    expect(prevStep("identity")).toBeNull();
    expect(prevStep("specialties")).toBe("eligibility");
  });
  it("resumes from wizard_state.step, defaulting to identity", () => {
    expect(resumeStep(lead())).toBe("eligibility");
    expect(resumeStep(lead({ wizard_state: null }))).toBe("identity");
    expect(resumeStep(lead({ wizard_state: { step: "bogus" } }))).toBe("identity");
  });
});
