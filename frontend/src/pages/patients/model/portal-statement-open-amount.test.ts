import { describe, expect, it } from "vitest";

import {
  portalInvoiceIsThirdParty,
  portalInvoiceNeedsPaymentProof,
  portalInvoicePaidByRepresentative,
  portalOwnOpenBalances,
  portalThirdPartyPayerLabel,
  portalStatementAvailableCredit,
  portalStatementOpenAmount,
  portalStatementSettled,
  portalStatementSplit,
  type PortalAccountStatementItem,
} from "./portal-shared";

// Owner decision 2026-11-12 (QA L18/F15): Lukas pays Carla's INV-0020 as a
// third party; it is not Carla's own debt in the portal.
describe("third-party invoices in the patient's portal balance", () => {
  const own = { currency: "EUR", status: "sent", balance_due: "633.05", third_party_payer: false };
  const lukas = { currency: "EUR", status: "sent", balance_due: "663.05", third_party_payer: true };

  it("leaves a third party's invoice out of the own open total", () => {
    expect(portalInvoiceIsThirdParty(lukas)).toBe(true);
    expect(portalInvoiceIsThirdParty({})).toBe(false);
    expect(portalOwnOpenBalances([own, lukas]).get("EUR")).toBe(633.05);
    expect(portalOwnOpenBalances([lukas]).get("EUR")).toBeUndefined();
    expect(portalOwnOpenBalances([{ ...own, status: "cancelled" }, { ...own, balance_due: "10" }]).get("EUR")).toBe(10);
    expect(
      portalOwnOpenBalances([{ ...own, portal_visibility: { visible_to_patient: true, amounts_visible_to_patient: false, line_items_visible_to_patient: true, pdf_visible_to_patient: true, redaction_reason: null } }]).size,
    ).toBe(0);
  });

  // QA 2026-11-13 F-x6: no payment proof asked for the payer's invoice;
  // «zahlt» while open, «bezahlt von» only once paid.
  it("asks no payment proof for a third party's invoice and names who pays", () => {
    expect(portalInvoiceNeedsPaymentProof({ ...own, last_payment_proof_at: null })).toBe(true);
    expect(portalInvoiceNeedsPaymentProof({ ...lukas, last_payment_proof_at: null })).toBe(false);
    expect(portalInvoiceNeedsPaymentProof({ ...own, status: "paid", last_payment_proof_at: null })).toBe(false);
    expect(portalInvoiceNeedsPaymentProof({ ...own, last_payment_proof_at: "2026-11-12T10:00:00Z" })).toBe(false);
    expect(portalThirdPartyPayerLabel("Lukas Pfannkuchen", false, "de")).toBe("Zahlt Lukas Pfannkuchen");
    expect(portalThirdPartyPayerLabel("Lukas Pfannkuchen", true, "de")).toBe("Bezahlt von Lukas Pfannkuchen");
    expect(portalThirdPartyPayerLabel(null, true, "de")).toBe("Bezahlt von einem Dritten");
    expect(portalThirdPartyPayerLabel(" ", false, "ru")).toBe("Оплачивает третье лицо");
  });

  it("lists a third party's invoice and its credit notes on their own, by payer", () => {
    const split = portalStatementSplit([
      row({ id: "inv-19", document_number: "INV-0019", invoice_balance_due: "633.05" }),
      row({ id: "inv-20", document_number: "INV-0020", paid_by: "third_party", recipient_name: "Lukas Pfannkuchen", invoice_balance_due: "663.05" }),
      row({ id: "cn-1", kind: "credit_note", invoice_id: "inv-20", payment_state: "invoice_adjustment", amount_gross: "-10" }),
      row({ id: "cn-2", kind: "credit_note", invoice_id: "inv-19", payment_state: "invoice_adjustment", amount_gross: "-5" }),
    ]);
    expect(split.own.map((item) => item.id)).toEqual(["inv-19", "cn-2"]);
    expect(split.thirdParty).toHaveLength(1);
    expect(split.thirdParty[0].payer).toBe("Lukas Pfannkuchen");
    expect(split.thirdParty[0].items.map((item) => item.id)).toEqual(["inv-20", "cn-1"]);
    expect(split.thirdParty[0].due).toBe(663.05);
    expect(portalStatementSplit([row({ id: "a" })]).thirdParty).toEqual([]);
  });

  // Owner decision 2026-11-13: the other parent pays the contracting parent's invoice.
  it("keeps the other parent's invoice apart from a Kostenübernehmer's, without an amount due", () => {
    const jonas = { ...lukas, third_party_payer_name: "Jonas Vater", payer_is_representative: true };
    expect(portalInvoicePaidByRepresentative(jonas)).toBe(true);
    expect(portalInvoicePaidByRepresentative(lukas)).toBe(false);
    expect(portalInvoicePaidByRepresentative({ ...jonas, third_party_payer: false })).toBe(false);
    expect(portalInvoiceNeedsPaymentProof({ ...jonas, last_payment_proof_at: null })).toBe(false);
    expect(portalOwnOpenBalances([own, jonas]).get("EUR")).toBe(633.05);
    const split = portalStatementSplit([
      row({ id: "inv-1", paid_by: "third_party", paid_by_representative: true, recipient_name: "Jonas Vater", invoice_balance_due: "400" }),
      row({ id: "inv-2", paid_by: "third_party", recipient_name: "Jonas Vater", invoice_balance_due: "50" }),
    ]);
    expect(split.own).toEqual([]);
    expect(split.thirdParty.map((group) => [group.payer, group.representative, group.items.map((item) => item.id)])).toEqual([
      ["Jonas Vater", true, ["inv-1"]],
      ["Jonas Vater", false, ["inv-2"]],
    ]);
  });
});

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
