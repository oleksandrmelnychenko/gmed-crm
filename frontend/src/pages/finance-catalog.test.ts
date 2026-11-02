import { describe, expect, it } from "vitest";

import {
  agencyServiceGrossAmount,
  agencyServicePackageUsagesByServiceId,
  catalogEffectiveVatRate,
  createPackageItemFromAgencyService,
  packageItemPatchFromAgencyService,
  packageItemSelectablePriceVersions,
  packageItemVatRate,
  pricePeriodState,
  priceVersionNameLabel,
  recommendedPackageItemPriceVersion,
  seedTaxProfileText,
  sortPriceVersionsForDisplay,
  selectableTaxProfiles,
  activeTaxProfileId,
  priceVersionDirty,
  taxProfileRemovable,
  taxProfileVatRateIsValid,
  validateAgencyServiceForm,
} from "./finance-catalog";
import { ORDER_API_ERROR_KEYS } from "@/lib/order-api-errors";
import { t as translationsFor } from "@/lib/i18n";

describe("taxProfileRemovable", () => {
  it("offers removal for ordinary profiles, never for the active default or a system profile", () => {
    expect(taxProfileRemovable({ is_default: false, is_active: true, is_system: false })).toBe(true);
    expect(taxProfileRemovable({ is_default: true, is_active: false, is_system: false })).toBe(true);
    expect(taxProfileRemovable({ is_default: true, is_active: true, is_system: false })).toBe(false);
    expect(taxProfileRemovable({ is_default: false, is_active: true, is_system: true })).toBe(false);
  });

  it("hides archived profiles from new choices but keeps the one an entry already uses", () => {
    const profiles = [
      { id: "active", is_active: true },
      { id: "archived", is_active: false },
      { id: "archived-used", is_active: false },
    ];
    expect(selectableTaxProfiles(profiles, "").map((profile) => profile.id)).toEqual(["active"]);
    expect(selectableTaxProfiles(profiles, "archived-used").map((profile) => profile.id)).toEqual([
      "active",
      "archived-used",
    ]);
  });

  it("never preselects an archived profile for a new price (QA round 14)", () => {
    const profiles = [
      { id: "active", is_active: true },
      { id: "archived", is_active: false },
    ];
    expect(activeTaxProfileId(profiles, "active")).toBe("active");
    expect(activeTaxProfileId(profiles, "archived")).toBe("");
    expect(activeTaxProfileId(profiles, null)).toBe("");
  });

  it("asks before closing the price dialog only after a real change (QA round 14)", () => {
    const opened = {
      open: true, busy: false, error: "", kind: "service-package" as const, parentId: "p", versionId: "v",
      title: "Paket", name: "Preis", netPrice: "100", currency: "EUR", vatRate: "19", taxProfileId: "t",
      validFrom: "2026-01-01", validTo: "",
    };
    const baseline = JSON.stringify(["Preis", "100", "EUR", "19", "t", "2026-01-01", ""]);
    const form = { ...opened, baseline };
    // A refused delete leaves an error and the busy flag behind: no change.
    expect(priceVersionDirty({ ...form, error: "Единственную версию цены удалить нельзя.", busy: false })).toBe(false);
    expect(priceVersionDirty({ ...form, netPrice: "120" })).toBe(true);
    expect(priceVersionDirty(opened)).toBe(false);
  });

  it("explains the refused removals in both languages", () => {
    for (const code of ["tax_profile_system", "tax_profile_default", "price_version_used", "price_version_last", "tax_profile_inactive"]) {
      const key = ORDER_API_ERROR_KEYS[code];
      expect(key, code).toBeTruthy();
      for (const lang of ["de", "ru"] as const) {
        expect(translationsFor(lang).uiText[key], `${lang} ${code}`).toBeTruthy();
      }
    }
  });
});

describe("tax profile VAT rate", () => {
  it("accepts 0 to 100 % only (a 150 % profile must not reach invoices)", () => {
    expect(taxProfileVatRateIsValid(0)).toBe(true);
    expect(taxProfileVatRateIsValid(7)).toBe(true);
    expect(taxProfileVatRateIsValid(100)).toBe(true);
    expect(taxProfileVatRateIsValid(150)).toBe(false);
    expect(taxProfileVatRateIsValid(-1)).toBe(false);
    expect(taxProfileVatRateIsValid(Number.NaN)).toBe(false);
  });

  it("shows the billed rate in the VAT mapping, not an outdated catalog rate", () => {
    expect(catalogEffectiveVatRate({ vat_rate: "19", effective_vat_rate: "0" })).toBe("0");
    expect(catalogEffectiveVatRate({ vat_rate: "19" })).toBe("19");
  });
});

describe("seedTaxProfileText", () => {
  it("translates the English seed names while nobody renamed them", () => {
    expect(seedTaxProfileText("termin_fee_0", "Termin fee 0% VAT", "name", "ru")).toBe(
      "Организация лечения, НДС 0 %",
    );
    expect(seedTaxProfileText("standard_vat", "Standard VAT", "name", "de")).toBe("Regelsteuersatz");
    expect(seedTaxProfileText("standard_vat", "Eigener Name", "name", "ru")).toBeNull();
    expect(seedTaxProfileText("qa_profile", "Standard VAT", "name", "ru")).toBeNull();
  });
});

describe("priceVersionNameLabel", () => {
  it("writes the automatic version name with a German date and amount", () => {
    expect(priceVersionNameLabel("2026-04-14 · 240 EUR")).toBe("14.04.2026 · 240,00 €");
    expect(priceVersionNameLabel("Preis ab 2027-01-01")).toBe("Preis ab 01.01.2027");
    expect(priceVersionNameLabel(null)).toBe("");
  });
});

describe("pricePeriodState", () => {
  const today = "2026-09-04";

  it("distinguishes past, current and future price periods", () => {
    expect(pricePeriodState("2025-01-01", "2026-09-03", today)).toBe("past");
    expect(pricePeriodState("2026-09-04", null, today)).toBe("current");
    expect(pricePeriodState("2026-09-05", null, today)).toBe("future");
  });

  it("keeps both validity boundaries inclusive", () => {
    expect(pricePeriodState("2026-09-04", "2026-09-04", today)).toBe("current");
  });
});

describe("sortPriceVersionsForDisplay", () => {
  it("places the current price first while keeping every other version", () => {
    const versions = [
      { id: "previous", valid_from: "2026-01-01", valid_to: "2026-08-31" },
      { id: "future-later", valid_from: "2026-11-01", valid_to: null },
      { id: "current", valid_from: "2026-09-01", valid_to: "2026-09-30" },
      { id: "future-next", valid_from: "2026-10-01", valid_to: "2026-10-31" },
    ];

    expect(sortPriceVersionsForDisplay(versions, "2026-09-04").map((item) => item.id)).toEqual([
      "current",
      "future-next",
      "future-later",
      "previous",
    ]);
    expect(versions).toHaveLength(4);
  });
});

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
      agencyServicePriceVersionId: "",
      pricingMode: "automatic",
      description: "Interpreter support per hour",
      serviceKey: "interpreter_hours",
      unitLabel: "h",
      overageUnitPriceNet: "",
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
      agencyServicePriceVersionId: "",
      pricingMode: "automatic",
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
      agencyServicePriceVersionId: "",
      pricingMode: "automatic",
      description: "Interpreter support per hour",
      serviceKey: "interpreter_hours",
      includedQuantity: "1",
      unitLabel: "h",
      overageUnitPriceNet: "",
      taxProfileId: "",
      requiresPatientApproval: false,
    });
    expect(item.formKey).toMatch(/^package-item-form-/);
  });
});

describe("recommendedPackageItemPriceVersion", () => {
  it("recommends only the catalog version effective today", () => {
    const service = {
      price_versions: [
        {
          id: "past",
          currency: "EUR",
          valid_from: "2026-01-01",
          valid_to: "2026-08-31",
        },
        {
          id: "current",
          currency: "EUR",
          valid_from: "2026-09-01",
          valid_to: "2026-09-30",
        },
        {
          id: "future",
          currency: "EUR",
          valid_from: "2026-10-01",
          valid_to: null,
        },
      ],
    };

    expect(recommendedPackageItemPriceVersion(service as never, "2026-09-04")?.id).toBe(
      "current",
    );
    expect(recommendedPackageItemPriceVersion(service as never, "2027-01-01")?.id).toBe(
      "future",
    );
    expect(recommendedPackageItemPriceVersion(service as never, "2025-01-01")).toBeUndefined();
  });

  it("filters versions that do not match the package currency", () => {
    const service = {
      price_versions: [
        { id: "eur", currency: "EUR", valid_from: "2026-01-01", valid_to: null },
        { id: "usd", currency: "USD", valid_from: "2026-01-01", valid_to: null },
      ],
    };

    expect(
      packageItemSelectablePriceVersions(service as never, "eur", "2026-09-04").map(
        (version) => version.id,
      ),
    ).toEqual(["eur"]);
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

  it("requires the service name and validity start", () => {
    expect(
      validateAgencyServiceForm(
        { ...validForm, serviceKey: " ", serviceName: " " },
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
    expect(validateAgencyServiceForm({ ...validForm, serviceKey: "" }, messages)).toBe("");
    expect(validateAgencyServiceForm({ ...validForm, vatRate: "" }, messages)).toBe("");
  });
});
