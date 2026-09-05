import { describe, expect, it } from "vitest";

import type { QuoteItem } from "@/pages/contracts/model/types";
import type { Leistung } from "@/pages/orders/model/types";

import {
  calculateServiceLineEstimate,
  mergeCommercialQuoteReadiness,
  preferPersistedCommercialLines,
  quoteMatchesCurrentServices,
  type ServiceLine,
} from "./lead-wizard";

const storedLine = (price: string): ServiceLine => ({
  id: "wizard-line",
  agencyServiceId: "service-id",
  agencyServicePriceVersionId: "price-version-id",
  clientReference: "lead-wizard:lead-id:wizard-line",
  managedByWizard: true,
  description: "Concierge Service Essential (1 Tag)",
  catalogDescription: "",
  catalogUnitLabel: "Tag",
  currency: "EUR",
  quantity: "7",
  price,
  vat: "19",
});

describe("lead wizard commercial source of truth", () => {
  it("prefers persisted order prices over stale wizard-state prices", () => {
    const persisted = preferPersistedCommercialLines(
      [storedLine("150")],
      [{
        id: "order-line",
        agency_service_id: "service-id",
        agency_service_price_version_id: "persisted-price-version-id",
        client_reference: "lead-wizard:lead-id:wizard-line",
        description: "Concierge Service Essential (1 Tag)",
        quantity: "7",
        unit_price: "130",
        vat_rate: "19",
        currency: "EUR",
      } as Leistung],
    );

    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.price).toBe("130");
    expect(persisted[0]?.agencyServicePriceVersionId).toBe("persisted-price-version-id");
    expect(persisted[0]?.managedByWizard).toBe(true);
    expect(calculateServiceLineEstimate(persisted)).toEqual({
      net: 910,
      vat: 172.9,
      gross: 1082.9,
    });
  });

  it("keeps an authoritative empty order empty instead of restoring stale draft lines", () => {
    expect(preferPersistedCommercialLines([storedLine("150")], [])).toEqual([]);
    expect(preferPersistedCommercialLines([storedLine("150")], undefined)).toHaveLength(1);
  });

  it("rounds each line like the quote backend before summing totals", () => {
    const lowValueLine = storedLine("0.01");
    expect(calculateServiceLineEstimate([
      { ...lowValueLine, id: "line-1" },
      { ...lowValueLine, id: "line-2" },
      { ...lowValueLine, id: "line-3" },
    ])).toEqual({
      net: 0.21,
      vat: 0.03,
      gross: 0.24,
    });
  });

  it("treats only a quote built from persisted prices as current", () => {
    const persisted = [storedLine("130")];
    const estimate = calculateServiceLineEstimate(persisted);
    const quote = {
      total_gross: String(estimate.gross),
      line_items: [{
        description: persisted[0].description,
        quantity: persisted[0].quantity,
        unit_price: persisted[0].price,
        vat_rate: persisted[0].vat,
      }],
    } as QuoteItem;
    const staleQuote = {
      ...quote,
      line_items: [{
        ...quote.line_items[0],
        unit_price: "150",
      }],
    } as QuoteItem;

    expect(quoteMatchesCurrentServices(quote, persisted, estimate.gross)).toBe(true);
    expect(quoteMatchesCurrentServices(staleQuote, persisted, estimate.gross)).toBe(false);
  });

  it("does not show a green commercial status when server readiness rejects the quote", () => {
    expect(mergeCommercialQuoteReadiness(true, false, true)).toBe(false);
    expect(mergeCommercialQuoteReadiness(true, true, false)).toBe(false);
    expect(mergeCommercialQuoteReadiness(true, true, true)).toBe(true);
    expect(mergeCommercialQuoteReadiness(true, undefined, undefined)).toBe(true);
  });
});
