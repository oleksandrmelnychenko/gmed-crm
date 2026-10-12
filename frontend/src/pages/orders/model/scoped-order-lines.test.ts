import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import { canDeliverScopedLine, scopedLineName, scopedLineQuantity } from "./scoped-order-lines";
import type { OrderDetail } from "./types";

type Line = OrderDetail["leistungen"][number];

function line(overrides: Partial<Line>): Line {
  return {
    id: "line-1",
    description: "Трансфер из аэропорта",
    quantity: "1",
    unit_price: null,
    currency: "EUR",
    vat_rate: null,
    is_cost_passthrough: false,
    status: "planned",
    delivered_at: null,
    notes: null,
    provider_id: null,
    provider_name: null,
    doctor_id: null,
    doctor_name: null,
    agency_service_key: "airport_transfer",
    agency_service_name: "Airport transfer coordination",
    agency_service_unit_label: "ride",
    ...overrides,
  } as Line;
}

describe("scoped order lines", () => {
  it("names a line by its description, not the English catalog name", () => {
    expect(scopedLineName(line({}), t("ru"))).toBe("Трансфер из аэропорта");
    expect(scopedLineName(line({ description: "  " }), t("ru"))).toBe(
      t("ru").revenue_agency_service_catalog_airport_transfer,
    );
  });

  it("shows the catalogue's German name in the UI language, own text as written (QA C2-13)", () => {
    expect(scopedLineName(line({ description: "Flughafentransfer" }), t("ru"))).toBe(
      t("ru").revenue_agency_service_catalog_airport_transfer,
    );
    expect(scopedLineName(line({ description: "Flughafentransfer" }), t("de"))).toBe(
      t("de").revenue_agency_service_catalog_airport_transfer,
    );
    expect(scopedLineName(line({ description: "Abholung Hotel Adlon 7:30" }), t("ru"))).toBe(
      "Abholung Hotel Adlon 7:30",
    );
  });

  it("translates the catalog unit in the form the count needs (QA C2-04)", () => {
    expect(scopedLineQuantity(line({}), t("ru"), "ru")).toBe("1 поездка");
    expect(scopedLineQuantity(line({ quantity: "2" }), t("ru"), "ru")).toBe("2 поездки");
    expect(scopedLineQuantity(line({ quantity: "5" }), t("ru"), "ru")).toBe("5 поездок");
    expect(scopedLineQuantity(line({ quantity: "2" }), t("de"), "de")).toBe("2 Fahrten");
    expect(scopedLineQuantity(line({ quantity: "1.5", agency_service_unit_label: "hour" }), t("ru"), "ru")).toBe("1,5 часа");
    expect(scopedLineQuantity(line({}), t("ru"), "ru")).not.toContain("ride");
    expect(scopedLineQuantity(line({ agency_service_unit_label: null }), t("ru"), "ru")).toBe("1");
  });

  it("lets only the concierge record an open service line of its order part as delivered", () => {
    const concierge = { read_scope: "concierge_services" as const };
    expect(canDeliverScopedLine(concierge, line({}), "concierge")).toBe(true);
    expect(
      canDeliverScopedLine(concierge, line({ delivered_at: "2026-09-28T08:00:00Z" }), "concierge"),
    ).toBe(false);
    expect(canDeliverScopedLine(concierge, line({ status: "cancelled" }), "concierge")).toBe(false);
    // The interpreter team lead's order part is view-only.
    expect(
      canDeliverScopedLine({ read_scope: "interpreter_team" }, line({}), "teamlead_interpreter"),
    ).toBe(false);
    expect(canDeliverScopedLine(concierge, line({}), "teamlead_interpreter")).toBe(false);
  });
});
