import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import {
  activePackages,
  agencyServiceRows,
  packageItemLine,
  readsAgencyCatalogWithoutPrices,
} from "@/pages/services-agency-catalog.model";

describe("GMED catalogue for the concierge (read-only, no prices)", () => {
  it("is shown to the concierge only", () => {
    expect(readsAgencyCatalogWithoutPrices("concierge")).toBe(true);
    expect(readsAgencyCatalogWithoutPrices("ceo")).toBe(false);
    expect(readsAgencyCatalogWithoutPrices(undefined)).toBe(false);
  });

  it("lists active services by their name in the UI language", () => {
    const rows = agencyServiceRows(
      [
        {
          id: "b",
          service_name: "Flughafentransfer",
          name_ru: "Трансфер из аэропорта",
          description: "Abholung am Flughafen",
          description_ru: "Встреча в аэропорту",
          unit_label: "ride",
        },
        { id: "a", service_name: "Alt", is_active: false },
      ],
      t("ru"),
      "ru",
    );
    expect(rows).toEqual([
      {
        id: "b",
        name: "Трансфер из аэропорта",
        description: "Встреча в аэропорту",
        unit: t("ru").revenue_unit_ride,
      },
    ]);
    expect(agencyServiceRows([{ id: "b", service_name: "Flughafentransfer" }], t("de"), "de")[0])
      .toMatchObject({ name: "Flughafentransfer", description: "", unit: "" });
  });

  it("names what a package contains with the counted unit", () => {
    expect(
      packageItemLine(
        { id: "i", description: "Transfer", included_quantity: "2", unit_label: "ride" },
        t("ru"),
        "ru",
      ),
    ).toBe("Transfer — 2 поездки");
    expect(packageItemLine({ id: "i", description: "Begleitung" }, t("de"), "de")).toBe("Begleitung");
  });

  it("keeps active packages only", () => {
    expect(
      activePackages([
        { id: "1", package_key: "b", name: "B", items: [] },
        { id: "2", package_key: "a", name: "A", is_active: false, items: [] },
      ]).map((entry) => entry.id),
    ).toEqual(["1"]);
  });
});
