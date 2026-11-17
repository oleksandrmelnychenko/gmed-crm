import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  conciergeSaleGross,
  orderBudgetSourceText,
  orderBudgetState,
  orderBudgetText,
  plannedVisitsDeltaGross,
  type OrderBudget,
} from "./order-budget";
import { OrderBudgetLine } from "./order-budget-indicator";

function budget(overrides: Partial<OrderBudget> = {}): OrderBudget {
  return {
    order_id: "order-1",
    currency: "EUR",
    contract: {
      source: "order_signature",
      signed_at: "2026-11-12T10:00:00Z",
      document_id: null,
      quote_number: null,
      quotes: 0,
      amendments: 0,
    },
    contract_own_services_net: "1680.67",
    contract_own_services_gross: "2000",
    planned_own_services_net: "1554.62",
    planned_own_services_gross: "1850",
    invoiced_own_services_net: "0",
    invoiced_own_services_gross: "0",
    remaining_net: null,
    remaining_gross: "150",
    over_by_net: null,
    over_by_gross: null,
    free_visit_units: 1,
    visit_fee_net: "50",
    visit_fee_gross: "59.5",
    concierge_vat_rate: "19",
    ...overrides,
  };
}

const text = (value: string) => value.replace(/\s/g, " ");

describe("order budget indicator", () => {
  it("shows contract, plan and rest within 90 %", () => {
    const state = orderBudgetState(budget({ planned_own_services_gross: "1500" }));
    expect(state.kind).toBe("ok");
    expect(text(orderBudgetText(state, "ru"))).toBe(
      "По договору 2.000,00 € · запланировано 1.500,00 € · остаток 500,00 €",
    );
    expect(text(orderBudgetText(state, "de"))).toBe("Laut Vertrag 2.000,00 € · geplant 1.500,00 € · Rest 500,00 €");
  });

  it("turns amber above 90 % of the contract", () => {
    const state = orderBudgetState(budget());
    expect(state.kind).toBe("near");
    expect(text(orderBudgetText(state, "ru"))).toBe(
      "По договору 2.000,00 € · запланировано 1.850,00 € · остаток 150,00 €",
    );
    const markup = renderToStaticMarkup(<OrderBudgetLine budget={budget()} lang="ru" />);
    expect(markup).toContain('data-state="near"');
    expect(markup).toContain("text-amber-700");
  });

  it("shows the overrun in red", () => {
    const state = orderBudgetState(budget({ planned_own_services_gross: "2238" }));
    expect(state.kind).toBe("over");
    expect(text(orderBudgetText(state, "ru"))).toBe(
      "По договору 2.000,00 € · запланировано 2.238,00 € · Превышение на 238,00 €",
    );
    expect(text(orderBudgetText(state, "de"))).toBe(
      "Laut Vertrag 2.000,00 € · geplant 2.238,00 € · Überschreitung um 238,00 €",
    );
    const markup = renderToStaticMarkup(
      <OrderBudgetLine budget={budget({ planned_own_services_gross: "2238" })} lang="ru" />,
    );
    expect(markup).toContain('data-state="over"');
    expect(markup).toContain("text-destructive");
  });

  it("projects an action before it is saved", () => {
    const state = orderBudgetState(budget(), { deltaGross: 238 });
    expect(state.kind).toBe("over");
    expect(text(orderBudgetText(state, "ru"))).toBe(
      "По договору 2.000,00 € · запланировано 1.850,00 € → 2.088,00 € · Превышение на 88,00 €",
    );
  });

  it("compares invoices with the contract", () => {
    const state = orderBudgetState(budget({ invoiced_own_services_gross: "1190" }), {
      basis: "invoiced",
      deltaGross: 238,
    });
    expect(state.kind).toBe("ok");
    expect(text(orderBudgetText(state, "ru"))).toBe(
      "По договору 2.000,00 € · выставлено 1.190,00 € → 1.428,00 € · остаток 572,00 €",
    );
  });

  it("is muted without a signed contract", () => {
    const unset = budget({ contract: null, contract_own_services_gross: null, contract_own_services_net: null });
    const state = orderBudgetState(unset);
    expect(state.kind).toBe("unset");
    expect(orderBudgetText(state, "ru")).toBe("Договорная сумма не задана");
    expect(orderBudgetText(state, "de")).toBe("Vertragssumme nicht festgelegt");
    const markup = renderToStaticMarkup(<OrderBudgetLine budget={unset} lang="ru" deltaGross={500} />);
    expect(markup).toContain('data-state="unset"');
    expect(markup).toContain("text-muted-foreground");
    expect(orderBudgetSourceText(unset, "ru")).toBeNull();
  });

  it("renders nothing before the budget is loaded", () => {
    expect(renderToStaticMarkup(<OrderBudgetLine budget={null} lang="ru" />)).toBe("");
  });

  it("names the signed version", () => {
    expect(orderBudgetSourceText(budget(), "ru")).toBe("Подписанный заказ 12.11.2026");
    expect(
      orderBudgetSourceText(
        budget({
          contract: {
            source: "quote",
            signed_at: null,
            document_id: null,
            quote_number: "KV-7",
            quotes: 1,
            amendments: 2,
          },
        }),
        "ru",
      ),
    ).toBe("Смета KV-7 + доп. соглашения: 2");
  });

  it("projects new visits beyond free units and concierge prices with VAT", () => {
    expect(plannedVisitsDeltaGross(budget(), 3)).toBe(119);
    expect(plannedVisitsDeltaGross(budget({ visit_fee_gross: null }), 3)).toBe(0);
    expect(plannedVisitsDeltaGross(budget(), 1)).toBe(0);
    expect(conciergeSaleGross(budget(), 100)).toBe(119);
    expect(conciergeSaleGross(budget(), Number.NaN)).toBe(0);
  });

  it("works on the totals the concierge receives (owner 2026-11-17)", () => {
    // The server's allowlist for the concierge: no contract details,
    // invoiced amounts, visit fee or free units.
    const totals: OrderBudget = {
      order_id: "order-1",
      currency: "EUR",
      contract_own_services_net: "1680.67",
      contract_own_services_gross: "2000",
      planned_own_services_net: "1554.62",
      planned_own_services_gross: "1850",
      remaining_net: "126.05",
      remaining_gross: "150",
      over_by_net: null,
      over_by_gross: null,
      concierge_vat_rate: "19",
    };
    // A 200 € concierge sale price (238 € gross) would run over.
    const html = renderToStaticMarkup(
      <OrderBudgetLine
        budget={totals}
        lang="ru"
        deltaGross={(loaded) => conciergeSaleGross(loaded, 200)}
        testId="concierge-service-budget"
      />,
    );
    expect(html).toContain('data-testid="concierge-service-budget"');
    expect(html).toContain('data-state="over"');
    expect(text(html)).toContain("1.850,00 € → 2.088,00 €");
    expect(text(html)).toContain("Превышение на 88,00 €");
    expect(html).not.toContain("title=");
    expect(orderBudgetSourceText(totals, "ru")).toBeNull();
    expect(plannedVisitsDeltaGross(totals, 2)).toBe(0);
  });
});
