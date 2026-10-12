import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import { economicsServiceName } from "./order-economics-names";
import type { OrderServiceEconomics } from "./types";

function service(extra: Partial<OrderServiceEconomics>): OrderServiceEconomics {
  return {
    order_leistung_id: "line-1",
    name: "Dolmetscherbetreuung",
    description: "Dolmetscherbetreuung",
    currency: "EUR",
    currency_matches_order: true,
    calculation_valid: true,
    planned_revenue_net: "237.5",
    planned_revenue_vat: "45.13",
    planned_revenue_gross: "282.63",
    planned_partner_cost_net: null,
    planned_partner_cost_vat: null,
    planned_partner_cost_gross: null,
    actual_revenue_net: "0",
    actual_revenue_vat: "0",
    actual_revenue_gross: "0",
    actual_partner_cost_net: null,
    actual_partner_cost_vat: null,
    actual_partner_cost_gross: null,
    margin_net: null,
    ...extra,
  } as OrderServiceEconomics;
}

// QA D3-03: the RU order economics listed the German document names.
describe("economicsServiceName", () => {
  it("shows a catalogue service in the UI language", () => {
    const line = service({
      agency_service_key: "interpreter_hours",
      catalog_service_name: "Dolmetscherbetreuung",
    });
    expect(economicsServiceName(line, t("ru"), "ru")).toBe("Услуги переводчика");
    expect(economicsServiceName(line, t("de"), "de")).toBe("Dolmetscherbetreuung");
  });

  it("prefers the Russian name the agency entered in the catalogue", () => {
    const line = service({
      name: "Flughafentransfer Premium",
      agency_service_key: "airport_transfer_premium",
      catalog_service_name: "Flughafentransfer Premium",
      catalog_name_ru: "Трансфер из аэропорта (премиум)",
    });
    expect(economicsServiceName(line, t("ru"), "ru")).toBe("Трансфер из аэропорта (премиум)");
    expect(economicsServiceName(line, t("de"), "de")).toBe("Flughafentransfer Premium");
  });

  it("keeps a service text staff typed themselves", () => {
    const line = service({ name: "Zusatzbegleitung Klinik", description: "Zusatzbegleitung Klinik" });
    expect(economicsServiceName(line, t("ru"), "ru")).toBe("Zusatzbegleitung Klinik");
  });
});
