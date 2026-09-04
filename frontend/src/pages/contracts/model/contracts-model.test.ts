import { describe, expect, it } from "vitest";

import {
  blankContractForm,
  contractActionErrorMessage,
  resolveAgencyServicePrice,
  validateCreateContractForm,
  validateContractStatusForm,
  type ContractFormValidationMessages,
} from "./contracts-model";
import type { AgencyServiceItem } from "./types";

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

const datedService: AgencyServiceItem = {
  id: "service-1",
  service_key: "concierge_day",
  service_name: "Concierge day",
  description: null,
  unit_label: "day",
  unit_price: "100",
  currency: "EUR",
  vat_rate: "19",
  is_active: true,
  valid_from: "2026-01-01",
  valid_to: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  price_versions: [
    {
      id: "price-1",
      name: "2026 H1",
      unit_price: "100",
      currency: "EUR",
      vat_rate: "19",
      valid_from: "2026-01-01",
      valid_to: "2026-06-30",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "price-2",
      name: "2026 H2",
      unit_price: "125",
      currency: "EUR",
      vat_rate: "19",
      valid_from: "2026-07-01",
      valid_to: null,
      created_at: "2026-06-01T00:00:00Z",
    },
  ],
};

describe("resolveAgencyServicePrice", () => {
  it("selects the price version active on the business date", () => {
    expect(resolveAgencyServicePrice(datedService, "2026-06-30")?.id).toBe("price-1");
    expect(resolveAgencyServicePrice(datedService, "2026-07-01")?.id).toBe("price-2");
    expect(resolveAgencyServicePrice(datedService, "2026-08-15")?.unit_price).toBe("125");
  });

  it("returns no price when neither history nor the catalog row covers the date", () => {
    expect(resolveAgencyServicePrice(datedService, "2025-12-31")).toBeNull();
  });
});

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

  it("never surfaces a bare HTTP status code to the user", () => {
    expect(contractActionErrorMessage(new Error("422"), messages, "Fallback")).toBe(
      "Fallback",
    );
    expect(
      contractActionErrorMessage(
        Object.assign(new Error("500"), { status: 500 }),
        messages,
        "Fallback",
      ),
    ).toBe("Please fill in the required contract fields.");
    expect(
      contractActionErrorMessage(
        Object.assign(new Error("Contract already exists"), { status: 409 }),
        messages,
        "Fallback",
      ),
    ).toBe("Contract already exists");
  });
});
