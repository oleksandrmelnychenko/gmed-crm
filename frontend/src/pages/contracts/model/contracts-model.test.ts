import { describe, expect, it } from "vitest";

import {
  blankContractForm,
  validateCreateContractForm,
  type ContractFormValidationMessages,
} from "./contracts-model";

const messages: ContractFormValidationMessages = {
  invalidConditionsJson: "Conditions must be valid JSON.",
  patientRequired: "Patient is required.",
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
