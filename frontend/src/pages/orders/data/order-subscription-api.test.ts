import { describe, expect, it } from "vitest";

import { orderTariffOptionLabels, type OrderTariffOption } from "./order-subscription-api";

const option = (id: string, patch: Partial<OrderTariffOption> = {}): OrderTariffOption => ({
  id,
  kind: "gmed_one",
  package_key: `gmed_one_${id}`,
  name: "Synthetic Portal Subscription",
  base_price_gross: "100.00",
  currency: "EUR",
  ...patch,
});

const labels = (options: OrderTariffOption[]) =>
  orderTariffOptionLabels(options, () => "GMED One", (amount, currency) => `${amount} ${currency}`);

describe("orderTariffOptionLabels", () => {
  it("keeps a unique tariff short", () => {
    expect(labels([option("a", { name: "Basis" }), option("b")]).get("a")).toBe("GMED One · Basis");
  });

  it("tells equal tariffs apart by price, then by key (QA C-07)", () => {
    const result = labels([option("a"), option("b", { base_price_gross: "200.00" }), option("c")]);
    expect(result.get("b")).toBe("GMED One · Synthetic Portal Subscription · 200.00 EUR");
    expect(result.get("a")).toBe("GMED One · Synthetic Portal Subscription · 100.00 EUR · gmed_one_a");
    expect(new Set(result.values()).size).toBe(3);
  });
});
