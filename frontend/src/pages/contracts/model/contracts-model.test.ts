import { describe, expect, it } from "vitest";

import {
  blankContractForm,
  contractActionErrorMessage,
  validateCreateContractForm,
  validateContractStatusForm,
  type ContractFormValidationMessages,
} from "./contracts-model";

const messages: ContractFormValidationMessages = {
  invalidConditionsJson: "Conditions must be valid JSON.",
  invalidDate: "Please check the date fields.",
  invalidDateTime: "Please check the signed-at field.",
  invalidPatient: "Please choose a valid patient.",
  invalidStatus: "Please choose a valid status.",
  patientRequired: "Patient is required.",
  requiredFields: "Please fill in the required contract fields.",
  sessionExpired: "Session expired.",
  validFromRequired: "Valid from is required.",
  validToBeforeValidFrom: "Valid to cannot be before valid from.",
};

describe("validateCreateContractForm", () => {
  it("returns user-facing required field errors before the API can return 422", () => {
    expect(validateCreateContractForm(blankContractForm(), messages)).toBe(
      "Patient is required.",
    );
    expect(
      validateCreateContractForm(
        {
          ...blankContractForm("patient-1"),
          validFrom: "",
        },
        messages,
      ),
    ).toBe("Valid from is required.");
  });

  it("validates date order and JSON conditions locally", () => {
    expect(
      validateCreateContractForm(
        {
          ...blankContractForm("patient-1"),
          validFrom: "2026-06-15",
          validTo: "2026-06-14",
        },
        messages,
      ),
    ).toBe("Valid to cannot be before valid from.");
    expect(
      validateCreateContractForm(
        {
          ...blankContractForm("patient-1"),
          conditionsText: "{not json",
          validFrom: "2026-06-15",
        },
        messages,
      ),
    ).toBe("Conditions must be valid JSON.");
  });

  it("accepts the minimal valid contract form", () => {
    expect(
      validateCreateContractForm(
        {
          ...blankContractForm("patient-1"),
          validFrom: "2026-06-15",
        },
        messages,
      ),
    ).toBe("");
  });
});

describe("validateContractStatusForm", () => {
  it("validates editable date order and JSON conditions before update", () => {
    expect(
      validateContractStatusForm(
        {
          validFrom: "2026-06-15",
          validTo: "2026-06-14",
          conditionsText: "",
        },
        messages,
      ),
    ).toBe("Valid to cannot be before valid from.");
    expect(
      validateContractStatusForm(
        {
          validFrom: "",
          validTo: "",
          conditionsText: "{not json",
        },
        messages,
      ),
    ).toBe("Conditions must be valid JSON.");
  });
});

describe("contractActionErrorMessage", () => {
  it("maps contract 422 API errors to user-facing field messages", () => {
    expect(
      contractActionErrorMessage(
        Object.assign(new Error("missing field `patient_id`"), { status: 422 }),
        messages,
        "Fallback",
      ),
    ).toBe("Patient is required.");
    expect(
      contractActionErrorMessage(
        Object.assign(new Error("Invalid datetime (RFC3339)"), { status: 422 }),
        messages,
        "Fallback",
      ),
    ).toBe("Please check the signed-at field.");
    expect(
      contractActionErrorMessage(
        Object.assign(new Error("unknown backend validation text"), {
          status: 422,
        }),
        messages,
        "Fallback",
      ),
    ).toBe("Please fill in the required contract fields.");
  });
});
