import { describe, expect, it } from "vitest";

import {
  agencyServiceGrossAmount,
  agencyServicePackageUsagesByServiceId,
  createPackageItemFromAgencyService,
  packageItemPatchFromAgencyService,
  packageItemVatRate,
  validateAgencyServiceForm,
} from "./finance-catalog";

describe("packageItemVatRate", () => {
  const servicePackage = {
    tax_profile_vat_rate: "19",
  };

  it("uses item, agency service, package and zero VAT fallbacks in order", () => {
    expect(
      packageItemVatRate(
        {
          tax_profile_vat_rate: "7",
          agency_service_vat_rate: "19",
        } as never,
        servicePackage as never,
      ),
    ).toBe("7");

    expect(
      packageItemVatRate(
        {
          tax_profile_vat_rate: null,
          agency_service_vat_rate: "19",
        } as never,
        servicePackage as never,
      ),
    ).toBe("19");

    expect(
      packageItemVatRate(
        {
          tax_profile_vat_rate: null,
          agency_service_vat_rate: null,
        } as never,
        servicePackage as never,
      ),
    ).toBe("19");

    expect(
      packageItemVatRate(
        {
          tax_profile_vat_rate: null,
          agency_service_vat_rate: null,
        } as never,
        { tax_profile_vat_rate: null } as never,
      ),
    ).toBe("0");
  });
});

describe("packageItemPatchFromAgencyService", () => {
  it("prefills package item fields from the selected catalog service", () => {
    expect(
      packageItemPatchFromAgencyService(
        {
          id: "service-1",
          service_key: "interpreter_hours",
          service_name: "Interpreter hours",
          description: "Interpreter support per hour",
          unit_label: "h",
          unit_price: "120.50",
        },
        "ед.",
      ),
    ).toEqual({
      agencyServiceId: "service-1",
      description: "Interpreter support per hour",
      serviceKey: "interpreter_hours",
      unitLabel: "h",
      overageUnitPriceNet: "120.50",
    });
  });

  it("falls back to service name and default unit for sparse catalog services", () => {
    expect(
      packageItemPatchFromAgencyService(
        {
          id: "service-2",
          service_key: "transfer",
          service_name: "Transfer",
          description: "   ",
          unit_label: "",
          unit_price: null,
        },
        "ед.",
      ),
    ).toEqual({
      agencyServiceId: "service-2",
      description: "Transfer",
      serviceKey: "transfer",
      unitLabel: "ед.",
      overageUnitPriceNet: "",
    });
  });
});

describe("createPackageItemFromAgencyService", () => {
  it("creates a new package item row from an existing catalog service", () => {
    const item = createPackageItemFromAgencyService(
      {
        id: "service-1",
        service_key: "interpreter_hours",
        service_name: "Interpreter hours",
        description: "Interpreter support per hour",
        unit_label: "h",
        unit_price: "120.50",
      },
      "ед.",
    );

    expect(item).toMatchObject({
      agencyServiceId: "service-1",
      description: "Interpreter support per hour",
      serviceKey: "interpreter_hours",
      includedQuantity: "1",
      unitLabel: "h",
      overageUnitPriceNet: "120.50",
      taxProfileId: "",
      requiresPatientApproval: false,
    });
    expect(item.formKey).toMatch(/^package-item-form-/);
  });
});

describe("agencyServiceGrossAmount", () => {
  it("calculates a catalog item gross price from net price and VAT", () => {
    expect(
      agencyServiceGrossAmount({
        unit_price: "100",
        vat_rate: "19",
      } as never),
    ).toBe(119);
    expect(
      agencyServiceGrossAmount({
        unit_price: "12.5",
        vat_rate: "7",
      } as never),
    ).toBe(13.38);
  });
});

describe("agencyServicePackageUsagesByServiceId", () => {
  it("groups package usage by agency service without duplicate package links", () => {
    const usages = agencyServicePackageUsagesByServiceId([
      {
        id: "package-1",
        package_key: "premium",
        name: "Premium",
        is_active: true,
        items: [
          { agency_service_id: "service-1" },
          { agency_service_id: "service-1" },
          { agency_service_id: "service-2" },
        ],
      },
      {
        id: "package-2",
        package_key: "archive",
        name: "Archive",
        is_active: false,
        items: [{ agency_service_id: "service-1" }],
      },
    ] as never);

    expect(usages.get("service-1")).toEqual([
      { id: "package-1", packageKey: "premium", name: "Premium", isActive: true },
      { id: "package-2", packageKey: "archive", name: "Archive", isActive: false },
    ]);
    expect(usages.get("service-2")).toEqual([
      { id: "package-1", packageKey: "premium", name: "Premium", isActive: true },
    ]);
  });
});

describe("validateAgencyServiceForm", () => {
  const messages = {
    required: "required",
    unitPrice: "unit price",
    vatRate: "vat rate",
  };
  const validForm = {
    serviceKey: "interpreter_hours",
    serviceName: "Interpreter hours",
    unitPrice: "120,50",
    vatRate: "19",
    validFrom: "2026-06-19",
  };

  it("requires service identity and validity start", () => {
    expect(
      validateAgencyServiceForm(
        { ...validForm, serviceKey: " ", serviceName: "Interpreter hours" },
        messages,
      ),
    ).toBe("required");
    expect(
      validateAgencyServiceForm({ ...validForm, validFrom: "" }, messages),
    ).toBe("required");
  });

  it("rejects invalid price and VAT values before submit", () => {
    expect(
      validateAgencyServiceForm({ ...validForm, unitPrice: "" }, messages),
    ).toBe("unit price");
    expect(
      validateAgencyServiceForm({ ...validForm, unitPrice: "-1" }, messages),
    ).toBe("unit price");
    expect(
      validateAgencyServiceForm({ ...validForm, vatRate: "101" }, messages),
    ).toBe("vat rate");
    expect(
      validateAgencyServiceForm({ ...validForm, vatRate: "abc" }, messages),
    ).toBe("vat rate");
  });

  it("accepts comma decimal price and optional VAT", () => {
    expect(validateAgencyServiceForm(validForm, messages)).toBe("");
    expect(validateAgencyServiceForm({ ...validForm, vatRate: "" }, messages)).toBe("");
  });
});
