import { describe, expect, it } from "vitest";

import {
  blankPartnerCostAmounts,
  editPartnerCostAmounts,
  partnerCostAmountsForSubmit,
  partnerCostAmountsFrom,
  type PartnerCostAmounts,
} from "./partner-cost-amounts";

function typeInto(
  start: PartnerCostAmounts,
  ...edits: Array<["net" | "vat" | "gross", string]>
) {
  return edits.reduce(
    (amounts, [field, value]) => editPartnerCostAmounts(amounts, field, value),
    start,
  );
}

describe("planned partner cost amounts", () => {
  it("derives gross from net and VAT", () => {
    const amounts = typeInto(blankPartnerCostAmounts(), ["net", "100"], ["vat", "19"]);
    expect(amounts.gross).toBe("119.00");
    expect(partnerCostAmountsForSubmit(amounts)).toEqual({ net: 100, vat: 19, gross: 119 });
  });

  it("derives net when gross is typed, also when VAT follows", () => {
    const amounts = typeInto(
      blankPartnerCostAmounts(),
      ["gross", "119,00"],
      ["vat", "19"],
    );
    expect(amounts).toMatchObject({ net: "100.00", gross: "119,00", source: "gross" });
    expect(partnerCostAmountsForSubmit(amounts)).toEqual({ net: 100, vat: 19, gross: 119 });
  });

  it("rounds typed amounts to cents like the server", () => {
    const amounts = typeInto(blankPartnerCostAmounts(), ["net", "10.005"], ["vat", "1,904"]);
    expect(amounts.gross).toBe("11.91");
    expect(partnerCostAmountsForSubmit(amounts)).toEqual({ net: 10.01, vat: 1.9, gross: 11.91 });
  });

  it("accepts an empty cost and a cost without VAT", () => {
    expect(partnerCostAmountsForSubmit(blankPartnerCostAmounts())).toEqual({
      net: 0,
      vat: 0,
      gross: 0,
    });
    const noVat = typeInto(blankPartnerCostAmounts(), ["net", "250"]);
    expect(noVat.gross).toBe("250.00");
    expect(partnerCostAmountsForSubmit(noVat)).toEqual({ net: 250, vat: 0, gross: 250 });
  });

  it("refuses amounts that are not non-negative numbers or VAT above gross", () => {
    const text = typeInto(blankPartnerCostAmounts(), ["net", "abc"]);
    expect(text.gross).toBe("");
    expect(partnerCostAmountsForSubmit(text)).toBeNull();

    const negative = typeInto(blankPartnerCostAmounts(), ["net", "-5"]);
    expect(partnerCostAmountsForSubmit(negative)).toBeNull();

    const vatAboveGross = typeInto(blankPartnerCostAmounts(), ["gross", "10"], ["vat", "20"]);
    expect(vatAboveGross.net).toBe("");
    expect(partnerCostAmountsForSubmit(vatAboveGross)).toBeNull();
  });

  it("starts the editor from the saved amounts and keeps them consistent", () => {
    const saved = partnerCostAmountsFrom("80.00", "15.20", "95.20");
    expect(partnerCostAmountsForSubmit(saved)).toEqual({ net: 80, vat: 15.2, gross: 95.2 });
    expect(editPartnerCostAmounts(saved, "net", "90").gross).toBe("105.20");
    expect(partnerCostAmountsFrom(null, undefined, null)).toMatchObject({
      net: "0",
      vat: "0",
      gross: "0",
    });
  });
});
