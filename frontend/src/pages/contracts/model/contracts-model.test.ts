import { describe, expect, it } from "vitest";

import {
  blankContractForm,
  contractActionErrorMessage,
  contractToStatusForm,
  formatDate,
  formatDateTime,
  listAgencyServicePriceChoices,
  resolveAgencyServicePrice,
  validateCreateContractForm,
  validateContractStatusForm,
  canTerminateContractStatus,
  CONTRACT_MANUAL_STATUSES,
  isQuoteSuperseded,
  isValidTerminationReason,
  QUOTE_FILTER_STATUSES,
  QUOTE_STATUSES,
  type ContractFormValidationMessages,
} from "./contracts-model";
import type { AgencyServiceItem, ContractItem } from "./types";

const messages: ContractFormValidationMessages = {
  invalidConditionsJson: "Conditions must be valid JSON.",
  invalidDate: "Please check the date fields.",
  invalidDateTime: "Please check the signed-at field.",
  invalidPatient: "Please choose a valid patient.",
  invalidStatus: "Please choose a valid status.",
  patientRequired: "Patient is required.",
  requiredFields: "Please fill in the required contract fields.",
  sessionExpired: "Session expired.",
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

describe("listAgencyServicePriceChoices", () => {
  it("returns every version and marks the automatic price for the commercial date", () => {
    const choices = listAgencyServicePriceChoices(datedService, "2026-07-01");

    expect(choices.map((choice) => choice.id)).toEqual(["price-2", "price-1"]);
    expect(choices.find((choice) => choice.is_effective)?.id).toBe("price-2");
    expect(choices.every((choice) => !choice.is_catalog_fallback)).toBe(true);
  });

  it("keeps a legacy catalog price selectable when it has no version rows", () => {
    const choices = listAgencyServicePriceChoices({
      ...datedService,
      price_versions: [],
      unit_price: "95",
      valid_from: "2026-01-01",
      valid_to: null,
    }, "2026-08-01");

    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({
      id: "",
      unit_price: "95",
      is_catalog_fallback: true,
      is_effective: true,
    });
  });

  it("includes the catalog fallback when dated versions leave a gap", () => {
    const choices = listAgencyServicePriceChoices({
      ...datedService,
      unit_price: "110",
      valid_from: "2026-01-01",
      valid_to: null,
      price_versions: datedService.price_versions?.map((version) => (
        version.id === "price-2"
          ? { ...version, valid_from: "2026-08-01" }
          : version
      )),
    }, "2026-07-15");

    expect(choices.map((choice) => choice.id)).toEqual(["price-2", "price-1", ""]);
    expect(choices.find((choice) => choice.is_effective)).toMatchObject({
      id: "",
      unit_price: "110",
      is_catalog_fallback: true,
    });
  });

  it("does not expose an inactive legacy fallback as a selectable price", () => {
    expect(listAgencyServicePriceChoices({
      ...datedService,
      price_versions: [],
      valid_from: "2026-02-01",
    }, "2026-01-15")).toEqual([]);
  });
});

describe("validateCreateContractForm", () => {
  it("returns user-facing required field errors before the API can return 422", () => {
    expect(validateCreateContractForm(blankContractForm(), messages)).toBe(
      "Patient is required.",
    );
  });

  it("validates JSON conditions locally", () => {
    expect(
      validateCreateContractForm(
        { ...blankContractForm("patient-1"), conditionsText: "{not json" },
        messages,
      ),
    ).toBe("Conditions must be valid JSON.");
  });

  it("accepts an open-ended contract without any validity dates", () => {
    expect(validateCreateContractForm(blankContractForm("patient-1"), messages)).toBe("");
    expect(blankContractForm("patient-1")).not.toHaveProperty("validFrom");
    expect(blankContractForm("patient-1")).not.toHaveProperty("validTo");
  });
});

describe("validateContractStatusForm", () => {
  it("validates JSON conditions before update", () => {
    expect(validateContractStatusForm({ conditionsText: "{not json" }, messages)).toBe(
      "Conditions must be valid JSON.",
    );
    expect(validateContractStatusForm({ conditionsText: "" }, messages)).toBe("");
  });
});

describe("framework contract termination", () => {
  it("never offers terminated or expired as a manual status", () => {
    expect(CONTRACT_MANUAL_STATUSES).toEqual(["draft", "sent", "signed"]);
  });

  it("allows termination only for signed or sent contracts", () => {
    expect(canTerminateContractStatus("signed")).toBe(true);
    expect(canTerminateContractStatus("sent")).toBe(true);
    for (const status of ["draft", "terminated", "expired"]) {
      expect(canTerminateContractStatus(status)).toBe(false);
    }
  });

  it("requires a trimmed reason of 3 to 1000 characters", () => {
    expect(isValidTerminationReason("  ab ")).toBe(false);
    expect(isValidTerminationReason(" abc ")).toBe(true);
    expect(isValidTerminationReason("x".repeat(1000))).toBe(true);
    expect(isValidTerminationReason("x".repeat(1001))).toBe(false);
  });
});

describe("superseded quotes", () => {
  it("can be filtered by but never chosen as a manual status", () => {
    expect(QUOTE_STATUSES).not.toContain("superseded");
    expect(QUOTE_FILTER_STATUSES).toContain("superseded");
    expect(isQuoteSuperseded("superseded")).toBe(true);
    expect(isQuoteSuperseded("rejected")).toBe(false);
    expect(isQuoteSuperseded(undefined)).toBe(false);
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

describe("contract dates in Berlin time", () => {
  it("formats calendar dates and timestamps on their Berlin day", () => {
    expect(formatDate("2026-09-27", "de-DE")).toBe(formatDate("2026-09-27T10:00:00Z", "de-DE"));
    // 23:30 in Berlin, already 28 Sep in Kyiv.
    expect(formatDate("2026-09-27T21:30:00Z", "de-DE")).toBe(formatDate("2026-09-27", "de-DE"));
    // 00:30 in Berlin, still 27 Sep in UTC.
    expect(formatDate("2026-09-27T22:30:00Z", "de-DE")).toBe(formatDate("2026-09-28", "de-DE"));
    expect(formatDateTime("2026-09-27T21:30:00Z", "de-DE")).toContain("23:30");
    expect(formatDate("2026-09-27", "ru-RU")).toBe("27.09.2026");
    expect(formatDateTime("2026-09-27T21:30:00Z", "ru-RU")).toBe("27.09.2026 23:30");
  });

  it("prefills the signing time as Berlin wall-clock time", () => {
    const form = contractToStatusForm({
      status: "signed",
      signed_at: "2026-09-27T22:30:00Z",
      conditions: null,
    } as unknown as ContractItem);
    expect(form.signedAt).toBe("2026-09-28T00:30");
  });
});
