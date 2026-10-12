import { describe, expect, it } from "vitest";

import {
  creditNoteLimit,
  creditNoteSelectionPayload,
  creditableVatRates,
  creditsByAmount,
  effectiveCreditNoteSelection,
  emptyCreditNoteSelection,
  lineCreditable,
  previewCreditNote,
  type CreditNoteSelectionDraft,
} from "./credit-note";
import type { InvoiceCreditableLine } from "./types";

const lines: InvoiceCreditableLine[] = [
  {
    line_index: 0,
    description: "Behandlungsorganisation",
    quantity: "1",
    unit_price: "500",
    vat_rate: "19",
    is_cost_passthrough: false,
    line_net: "500",
    line_vat: "95",
    line_gross: "595",
    credited_gross: "0",
    remaining_gross: "595",
    remaining_vat: "95",
  },
  {
    line_index: 1,
    description: "Hotel",
    quantity: "3",
    unit_price: "160.5",
    vat_rate: "0",
    is_cost_passthrough: true,
    line_net: "481.5",
    line_vat: "0",
    line_gross: "481.5",
    credited_gross: "0",
    remaining_gross: "481.5",
    remaining_vat: "0",
  },
  {
    line_index: 2,
    description: "Transfer",
    quantity: "1",
    unit_price: "100",
    vat_rate: "19.00",
    is_cost_passthrough: false,
    line_net: "100",
    line_vat: "19",
    line_gross: "119",
    credited_gross: "119",
    remaining_gross: "0",
    remaining_vat: "0",
  },
];

function lineDraft(selected: Record<number, string>): CreditNoteSelectionDraft {
  return {
    mode: "lines",
    lines: Object.fromEntries(
      Object.entries(selected).map(([index, amount]) => [index, { selected: true, amount }]),
    ),
    vatRate: "",
    amountGross: "",
  };
}

describe("credit-note selection", () => {
  it("lists open VAT rates with what is left in each", () => {
    expect(creditableVatRates(lines)).toEqual([
      { rate: "0", remainingGross: 481.5 },
      { rate: "19", remainingGross: 595 },
    ]);
    expect(emptyCreditNoteSelection(lines).vatRate).toBe("");
    expect(emptyCreditNoteSelection([lines[1]]).vatRate).toBe("0");
  });

  it("credits a 0 % pass-through line without VAT", () => {
    const draft = lineDraft({ 1: "" });
    expect(previewCreditNote(lines, draft)).toEqual({ gross: 481.5, vat: 0, net: 481.5, error: null });
    expect(creditNoteSelectionPayload(lines, draft)).toEqual({ lines: [{ line_index: 1 }] });
  });

  it("previews partial line credits with the line's VAT share and sends their amount", () => {
    const draft = lineDraft({ 0: "100", 1: "" });
    expect(previewCreditNote(lines, draft)).toEqual({ gross: 581.5, vat: 15.97, net: 565.53, error: null });
    expect(creditNoteSelectionPayload(lines, draft)).toEqual({
      lines: [{ line_index: 0, amount_gross: "100.00" }, { line_index: 1 }],
    });
  });

  it("flags empty selections and amounts above the line", () => {
    expect(previewCreditNote(lines, { ...lineDraft({}), lines: {} }).error).toBe("nothing_selected");
    expect(previewCreditNote(lines, lineDraft({ 0: "595.01" })).error).toBe("line_exceeded");
    expect(previewCreditNote(lines, lineDraft({ 0: "0" })).error).toBe("invalid_amount");
  });

  it("credits an amount within one VAT rate", () => {
    const draft: CreditNoteSelectionDraft = {
      mode: "vat_rate",
      lines: {},
      vatRate: "19",
      amountGross: "119",
    };
    expect(previewCreditNote(lines, draft)).toEqual({ gross: 119, vat: 19, net: 100, error: null });
    expect(creditNoteSelectionPayload(lines, draft)).toEqual({ vat_rate: "19", amount_gross: "119.00" });
    expect(previewCreditNote(lines, { ...draft, amountGross: "595.01" }).error).toBe("vat_rate_exceeded");
    expect(previewCreditNote(lines, { ...draft, vatRate: "7" }).error).toBe("vat_rate_missing");
  });

  it("never offers more than the server accepts (QA D2-01)", () => {
    // An advance of 300: 200 closed by a credit note, 100 credited into the
    // final invoice: the line still shows 100, the server accepts 0.
    const advanceLine: InvoiceCreditableLine = {
      ...lines[0],
      line_gross: "300",
      credited_gross: "200",
      remaining_gross: "100",
      remaining_vat: "15.97",
    };
    expect(creditNoteLimit("0")).toBe(0);
    expect(creditNoteLimit(undefined)).toBeNull();
    expect(lineCreditable(advanceLine, 0)).toBe(0);
    expect(lineCreditable(advanceLine, null)).toBe(100);
    expect(
      previewCreditNote([advanceLine], lineDraft({ 0: "" }), { limit: 0 }).error,
    ).toBe("limit_exceeded");
    expect(previewCreditNote(lines, lineDraft({ 0: "100" }), { limit: 150 }).error).toBeNull();
    expect(previewCreditNote(lines, lineDraft({ 0: "151" }), { limit: 150 }).error).toBe("limit_exceeded");
  });

  it("credits an amount on invoices whose lines carry no amounts (QA D-55)", () => {
    expect(creditsByAmount([], 400)).toBe(true);
    expect(creditsByAmount([], 0)).toBe(false);
    expect(creditsByAmount(lines, 400)).toBe(false);
    const selection = effectiveCreditNoteSelection([], 400, { ...lineDraft({}), amountGross: "400" });
    expect(selection.mode).toBe("amount");
    expect(emptyCreditNoteSelection([], 400).mode).toBe("amount");
    expect(previewCreditNote([], selection, { limit: 400, vatRatio: 0 })).toEqual({
      gross: 400,
      vat: 0,
      net: 400,
      error: null,
    });
    expect(previewCreditNote([], { ...selection, amountGross: "400.01" }, { limit: 400 }).error).toBe(
      "limit_exceeded",
    );
    // 19 % invoice: the VAT keeps the invoice's own share.
    expect(previewCreditNote([], { ...selection, amountGross: "119" }, { vatRatio: 19 / 119 }).vat).toBe(19);
    expect(creditNoteSelectionPayload([], selection)).toEqual({ amount_gross: "400.00" });
    // An invoice with lines never sends the plain amount.
    expect(effectiveCreditNoteSelection(lines, null, selection).mode).toBe("lines");
  });
});
