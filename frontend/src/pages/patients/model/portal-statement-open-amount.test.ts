import { describe, expect, it } from "vitest";

import {
  portalStatementAvailableCredit,
  portalStatementOpenAmount,
  portalStatementSettled,
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

  // QA 2026-11-11 L4: the 30,00 € credit of another order was shown as
  // «nach Abzug von Guthaben 30,00 €: 270,00 € zu zahlen» before Billing
  // applied it. The row keeps the invoice's own open amount and says nothing
  // about credit that is not applied.
  it("never takes credit off an invoice before Billing applies it", () => {
    expect(
      portalStatementOpenAmount(
        row({
          amount_due: "270.00",
          invoice_balance_due: "300.00",
          credit_applied: "30.00",
          advance_credit: "0",
        }),
      ),
    ).toEqual({ kind: "due", amount: "300.00" });
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
    ).toEqual({ kind: "due", amount: "100" });
  });
});

describe("portal statement booked to an invoice (QA 2026-11-11 L4)", () => {
  it("never shows more paid than the invoice asks for; the rest is overpayment", () => {
    // INV-0018: 1.461,70 €, advance 500 € applied, 1.000 € paid, 8,30 € refunded.
    expect(
      portalStatementSettled(
        row({
          amount_gross: "1461.70",
          adjusted_amount_gross: "1461.70",
          cash_paid: "991.70",
          prepayment_applied: "500.00",
        }),
      ),
    ).toEqual({ settled: 1461.7, overpayment: 30 });
  });

  it("a partly paid invoice has no overpayment", () => {
    expect(
      portalStatementSettled(row({ amount_gross: "300", cash_paid: "100", prepayment_applied: "0" })),
    ).toEqual({ settled: 100, overpayment: 0 });
  });

  it("counts credit notes in what the invoice asks for", () => {
    expect(
      portalStatementSettled(
        row({ amount_gross: "500", credited_amount: "100", cash_paid: "450" }),
      ),
    ).toEqual({ settled: 400, overpayment: 50 });
  });

  it("names unapplied credit once, as available", () => {
    expect(
      portalStatementAvailableCredit({ available_prepayment: "0", credit_balance: "30.00" }),
    ).toEqual({ advance: 0, overpayment: 30 });
    expect(
      portalStatementAvailableCredit({ available_prepayment: "-1", credit_balance: undefined }),
    ).toEqual({ advance: 0, overpayment: 0 });
  });
});
