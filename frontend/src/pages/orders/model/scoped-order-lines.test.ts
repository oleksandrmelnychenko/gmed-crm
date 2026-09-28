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

  it("translates the catalog unit", () => {
    expect(scopedLineQuantity(line({}), t("ru"))).toBe(`1 ${t("ru").revenue_unit_ride}`);
    expect(scopedLineQuantity(line({}), t("ru"))).not.toContain("ride");
    expect(scopedLineQuantity(line({ agency_service_unit_label: null }), t("ru"))).toBe("1");
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
