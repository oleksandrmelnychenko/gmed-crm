import { describe, expect, it } from "vitest";

import { patientInvoiceAmounts } from "./patient-invoice-amounts";

const base = {
  id: "invoice-1",
  invoice_number: "INV-20261011-0002",
  invoice_type: "final",
  status: "paid",
  issued_at: "2026-10-11T10:00:00Z",
};

describe("patient card invoice amounts", () => {
  it("add up after an advance and a credit note, like the invoice list", () => {
    const amounts = patientInvoiceAmounts({
      ...base,
      total_gross: "1192.63",
      credited_amount: "113.05",
      adjusted_total_gross: "1079.58",
      paid_amount: "529.58",
      prepayment_applied_amount: "550",
      balance_due: "0",
      credit_balance: "0",
    });
    expect(amounts.total).toBe(1079.58);
    expect(amounts.issuedTotal).toBe(1192.63);
    expect(amounts.settled).toBe(1079.58);
    expect(amounts.prepayment).toBe(550);
    expect(amounts.total - amounts.settled).toBe(amounts.balance);
  });

  it("keeps the balance open and shows an overpayment apart", () => {
    const open = patientInvoiceAmounts({
      ...base,
      status: "partially_paid",
      total_gross: "550",
      credited_amount: "0",
      adjusted_total_gross: "550",
      paid_amount: "200",
      prepayment_applied_amount: "300",
      balance_due: "50",
      credit_balance: "0",
    });
    expect(open.total - open.settled).toBe(open.balance);

    const overpaid = patientInvoiceAmounts({
      ...base,
      total_gross: "550",
      credited_amount: "100",
      adjusted_total_gross: "450",
      paid_amount: "550",
      prepayment_applied_amount: "0",
      balance_due: "0",
      credit_balance: "100",
    });
    expect(overpaid.total).toBe(450);
    expect(overpaid.balance).toBe(0);
    expect(overpaid.credit).toBe(100);
  });

  it("derives the corrected total for rows without one", () => {
    expect(
      patientInvoiceAmounts({
        ...base,
        total_gross: "100",
        credited_amount: "40",
        paid_amount: null,
        balance_due: "60",
      }).total,
    ).toBe(60);
  });
});
