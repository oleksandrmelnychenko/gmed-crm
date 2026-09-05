import { describe, expect, it } from "vitest";

import { preferPersistedCommercialLines, resolveServiceDescriptionItems, resolveServiceDescriptionTemplate } from "./lead-wizard";
import type { Leistung } from "@/pages/orders/model/types";

describe("lead wizard service document descriptions", () => {
  it("keeps the order's description snapshot when catalog wording changes", () => {
    const descriptionItems = [{ id: "original", text: "Original\n\nwording" }];
    const [line] = preferPersistedCommercialLines([], [{
      id: "order-line", description: "Service", agency_service_id: "catalog-item",
      agency_service_description: "New catalog wording",
      agency_service_description_items_snapshot: descriptionItems,
      quantity: "1", unit_price: "100", vat_rate: "19",
    } as Leistung]);
    expect(line.catalogDescriptionItems).toEqual(descriptionItems);
  });
  it("resolves each item without changing its identity, order, or paragraph boundary", () => {
    expect(resolveServiceDescriptionItems([
      { id: "support", text: "Support\n\nfrom [Datum Beginn] to [Datum Ende]." },
      { id: "coordination", text: "For [Fachrichtung 1]." },
    ], { dateFrom: "2026-09-10", dateTo: "2026-09-17", specialties: ["Dermatologie"] }))
      .toEqual([
        { id: "support", text: "Support\n\nfrom 10.09.2026 to 17.09.2026." },
        { id: "coordination", text: "For Dermatologie." },
      ]);
  });
  it("keeps catalog paragraphs for the Leistungsumfang list", () => {
    expect(resolveServiceDescriptionTemplate(
      "Erster Leistungsumfang.\n\nZweiter Leistungsumfang für [Fachrichtung 1] im Zeitraum [Datum Beginn] bis [Datum Ende].",
      {
        dateFrom: "2026-09-10",
        dateTo: "2026-09-17",
        specialties: ["Dermatologie", "Orthopädie"],
      },
    )).toBe(
      "Erster Leistungsumfang.\n\nZweiter Leistungsumfang für Dermatologie und Orthopädie im Zeitraum 10.09.2026 bis 17.09.2026.",
    );
  });

  it("keeps numbered catalog items on separate lines", () => {
    expect(resolveServiceDescriptionTemplate(
      "1) Dining support\n2) Transport coordination\n\nNOT INCLUDED\n- Security services",
      { dateFrom: "", dateTo: "", specialties: [] },
    )).toBe(
      "1) Dining support\n2) Transport coordination\n\nNOT INCLUDED\n- Security services",
    );
  });
});
