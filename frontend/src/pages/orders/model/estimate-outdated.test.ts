import { describe, expect, it } from "vitest";

import { estimateOutdatedMessage } from "./estimate-outdated";

const money = (value: string) => `${Number(value).toFixed(2)} €`;

describe("estimateOutdatedMessage (QA 2026-11-11, B-17)", () => {
  it("names what changed and leaves out an equal order sum", () => {
    const text = estimateOutdatedMessage(
      { quote_number: "QU-1", quote_total_gross: "1000", order_total_gross: "1000.00", reasons: ["prepayment"] },
      "ru",
      money,
    );
    expect(text).toContain("QU-1 (1000.00 €)");
    expect(text).toContain("изменились условия предоплаты");
    expect(text).not.toContain("сейчас");
  });

  it("shows the new order sum when it differs", () => {
    const text = estimateOutdatedMessage(
      { quote_number: "QU-2", quote_total_gross: "100", order_total_gross: "150", reasons: ["lines"] },
      "de",
      money,
    );
    expect(text).toContain("Positionen, Mengen oder Preise");
    expect(text).toContain("Auftragssumme jetzt 150.00 €");
  });

  it("joins several reasons and falls back without reasons", () => {
    expect(
      estimateOutdatedMessage(
        { quote_number: "QU-3", quote_total_gross: "1", order_total_gross: "1", reasons: ["vat", "contracting_party"] },
        "ru",
        money,
      ),
    ).toContain("изменилась ставка НДС позиции; сменилась сторона договора");
    expect(
      estimateOutdatedMessage({ quote_number: "QU-4", quote_total_gross: "1", order_total_gross: null }, "ru", money),
    ).toContain("она не совпадает с заказом");
  });
});
