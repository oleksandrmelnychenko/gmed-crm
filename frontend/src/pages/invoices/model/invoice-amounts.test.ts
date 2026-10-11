import { describe, expect, it } from "vitest";

import { creditNoteReleases, invoiceListAmounts, paymentCorrectionLimit } from "./invoice-amounts";

describe("invoice list amounts", () => {
  it("add up after an advance and a credit note (QA D-33)", () => {
    // INV-20261011-0002: 1.192,63 issued, credit note 113,05, advance 550,
    // cash 529,58.
    const row = invoiceListAmounts({
      total_gross: "1192.63",
      credited_amount: "113.05",
      adjusted_total_gross: "1079.58",
      paid_amount: "529.58",
      prepayment_applied_amount: "550",
      balance_due: "0",
      credit_balance: "0",
    });
    expect(row.total).toBe(1079.58);
    expect(row.issuedTotal).toBe(1192.63);
    expect(row.settled).toBe(1079.58);
    expect(row.total - row.settled).toBe(row.balance);
  });

  it("derives the corrected total when the list has none", () => {
    expect(
      invoiceListAmounts({
        total_gross: "100",
        credited_amount: "40",
        paid_amount: "0",
        balance_due: "60",
      }).total,
    ).toBe(60);
  });
});

describe("payment correction limit", () => {
  it("is the corrected total minus advances and the other receipts (QA D-07)", () => {
    // 550 invoice, receipts 200 + 400 (overpaid by 50): the 400 may become
    // 350 without overpaying.
    const invoice = {
      total_gross: "550",
      credited_amount: "0",
      adjusted_total_gross: "550",
      paid_amount: "600",
      prepayment_applied_amount: "0",
    };
    expect(paymentCorrectionLimit(invoice, { amount_gross: "400" })).toBe(350);
    expect(paymentCorrectionLimit(invoice, { amount_gross: "200" })).toBe(150);
  });

  it("counts credited advance money", () => {
    expect(
      paymentCorrectionLimit(
        {
          total_gross: "1192.63",
          credited_amount: "113.05",
          adjusted_total_gross: "1079.58",
          paid_amount: "529.58",
          prepayment_applied_amount: "550",
        },
        { amount_gross: "499.58" },
      ),
    ).toBe(499.58);
  });
});

describe("credit note releases", () => {
  it("names the advance money released below the applied advance (QA D-63)", () => {
    expect(
      creditNoteReleases(
        {
          total_gross: "499.80",
          credited_amount: "0",
          adjusted_total_gross: "499.80",
          prepayment_applied_amount: "300",
        },
        214.2,
      ),
    ).toEqual({ prepayment: 14.4, supplierCost: 0 });
  });

  it("names the re-billed supplier cost it unbills (QA D-64)", () => {
    expect(
      creditNoteReleases(
        {
          total_gross: "119",
          credited_amount: "0",
          adjusted_total_gross: "119",
          prepayment_applied_amount: "0",
          supplier_cost_allocated_gross: "119",
        },
        119,
      ),
    ).toEqual({ prepayment: 0, supplierCost: 119 });
    expect(
      creditNoteReleases(
        { total_gross: "100", adjusted_total_gross: "100", prepayment_applied_amount: "20" },
        50,
      ),
    ).toEqual({ prepayment: 0, supplierCost: 0 });
  });
});
