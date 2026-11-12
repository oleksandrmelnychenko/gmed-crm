import { describe, expect, it } from "vitest";

import { conciergeSalesView, type OrderConciergeSales } from "./order-concierge-sales";

const money = (value: unknown, currency: string) => `${Number(value).toFixed(2)} ${currency}`;

function sales(overrides: Partial<OrderConciergeSales> = {}): OrderConciergeSales {
  return {
    counted_in_totals: false,
    billed_total: "100",
    unbilled_total: "180",
    other_currency_count: 0,
    services: [
      {
        id: "ready",
        title: "Meet and greet",
        service_kind: "transfer",
        status: "completed",
        billing_status: "ready",
        billed: false,
        currency: "EUR",
        currency_matches_order: true,
        quantity: "1",
        unit_price: "180",
        sale_price: "180",
        starts_at: "2026-11-13T09:00:00Z",
      },
      {
        id: "billed",
        title: "Restaurant",
        service_kind: "other",
        status: "completed",
        billing_status: "billed",
        billed: true,
        currency: "EUR",
        currency_matches_order: true,
        quantity: "2",
        unit_price: "50",
        sale_price: "100",
        starts_at: null,
      },
    ],
    ...overrides,
  };
}

describe("conciergeSalesView", () => {
  it("shows nothing without concierge services with a sale price", () => {
    expect(conciergeSalesView(undefined, money, "EUR", "ru")).toBeNull();
    expect(conciergeSalesView(sales({ services: [] }), money, "EUR", "ru")).toBeNull();
  });

  it("splits billed and not yet billed sale prices as information outside the totals", () => {
    const view = conciergeSalesView(sales(), money, "EUR", "ru");
    expect(view).not.toBeNull();
    expect(view?.unbilledTotal).toBe(180);
    expect(view?.billedTotal).toBe(100);
    expect(view?.summary).toBe("Услуги Concierge: ещё не выставлено 180.00 EUR, выставлено 100.00 EUR (информативно).");
    expect(view?.note).toContain("не входят в суммы заказа");
    expect(view?.note).toContain("зарплатой");
    expect(view?.rows.map((row) => [row.id, row.state, row.salePrice, row.date])).toEqual([
      ["ready", "Готово к выставлению счёта", "180.00 EUR", "13.11.2026"],
      ["billed", "Выставлено без позиции счёта", "100.00 EUR", "—"],
    ]);
  });

  it("counts a service billed by an invoice line exactly and says so (F-C8)", () => {
    const base = sales();
    const view = conciergeSalesView(
      sales({
        invoiced_total: "120",
        services: [
          ...base.services,
          {
            ...base.services[1],
            id: "invoiced",
            title: "Airport transfer",
            invoiced: true,
            invoiced_net: "120",
            sale_price: "120",
          },
        ],
      }),
      money,
      "EUR",
      "ru",
    );
    expect(view?.invoicedTotal).toBe(120);
    expect(view?.summary).toBe(
      "Услуги Concierge: в счетах 120.00 EUR (учтено в доходе), ещё не выставлено 180.00 EUR, выставлено 100.00 EUR (информативно).",
    );
    const invoiced = view?.rows.find((row) => row.id === "invoiced");
    expect(invoiced?.invoiced).toBe(true);
    expect(invoiced?.state).toBe("В счёте (учтено в доходе)");
    expect(invoiced?.salePrice).toBe("120.00 EUR");
    expect(invoiced?.href).toBe("/services?service=invoiced");
  });

  it("says in German that services in another currency stay outside the sums", () => {
    const base = sales();
    const view = conciergeSalesView(
      sales({
        other_currency_count: 1,
        services: [
          ...base.services,
          { ...base.services[0], id: "usd", currency: "USD", currency_matches_order: false, billing_status: "draft" },
        ],
      }),
      money,
      "EUR",
      "de",
    );
    expect(view?.summary).toContain("noch nicht berechnet 180.00 EUR");
    expect(view?.note).toContain("anderer Währung (1)");
    const usd = view?.rows.find((row) => row.id === "usd");
    expect(usd?.outsideTotals).toBe(true);
    expect(usd?.state).toBe("Noch nicht berechnet");
    expect(usd?.salePrice).toBe("180.00 USD");
  });
});
