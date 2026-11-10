import { describe, expect, it } from "vitest";

import {
  portalStatementOpenAmount,
  statementCreditWords,
  type PortalAccountStatementItem,
} from "./portal-shared";

function row(patch: Partial<PortalAccountStatementItem>): PortalAccountStatementItem {
  return {
    id: "row",
    kind: "invoice",
    entry_date: "2026-10-11",
    description: "",
    status: "sent",
    payment_state: "unpaid",
    amounts_visible: true,
    ...patch,
  };
}

describe("portal statement open amount", () => {
  it("shows what an unpaid advance invoice asks for (QA D-50)", () => {
    expect(
      portalStatementOpenAmount(
        row({ kind: "prepayment", amount_due: "1000", prepayment_available: "0" }),
      ),
    ).toEqual({ kind: "due", amount: "1000" });
  });

  it("shows the unused money of a paid advance", () => {
    expect(
      portalStatementOpenAmount(
        row({ kind: "prepayment", amount_due: "0", prepayment_available: "250" }),
      ),
    ).toEqual({ kind: "available", amount: "250" });
  });

  it("shows what an invoice still asks for", () => {
    expect(portalStatementOpenAmount(row({ amount_due: "400" }))).toEqual({
      kind: "due",
      amount: "400",
    });
  });

  // QA 2026-11-10, D-03: 30,00 € overpaid on the advance invoice was taken
  // off the final invoice in this block only: 1.006,53 € here, 1.036,53 € in
  // the invoice list, the sheet and for Billing.
  it("keeps the invoice's own open amount and names the credit beside it", () => {
    expect(
      portalStatementOpenAmount(
        row({
          amount_due: "1006.53",
          invoice_balance_due: "1036.53",
          credit_applied: "30.00",
          advance_credit: "0",
        }),
      ),
    ).toEqual({
      kind: "due",
      amount: "1036.53",
      afterCredit: { advance: 0, overpayment: 30, toPay: "1006.53" },
    });
    expect(statementCreditWords(0, 30, "ru")).toBe("переплаты");
    expect(statementCreditWords(100, 0, "de")).toBe("Vorauszahlung");
    expect(statementCreditWords(100, 30, "ru")).toBe("предоплаты и переплаты");
  });

  it("names no credit when nothing is set against the row", () => {
    expect(
      portalStatementOpenAmount(
        row({ amount_due: "400", invoice_balance_due: "400", credit_applied: "0", advance_credit: "0" }),
      ),
    ).toEqual({ kind: "due", amount: "400" });
  });

  it("an unpaid advance covered by an overpayment still shows what it asks for", () => {
    expect(
      portalStatementOpenAmount(
        row({
          kind: "prepayment",
          amount_due: "0",
          invoice_balance_due: "100",
          credit_applied: "100",
          prepayment_available: "0",
        }),
      ),
    ).toEqual({
      kind: "due",
      amount: "100",
      afterCredit: { advance: 0, overpayment: 100, toPay: "0" },
    });
  });
});
