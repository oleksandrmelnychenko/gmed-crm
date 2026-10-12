import { describe, expect, it } from "vitest";

import { formatMoneyAmount } from "@/lib/money";

import {
  creditTransferDefaultAmount,
  creditTransferMismatchQuestion,
  creditTransferProblem,
  creditTransferRecipientMismatch,
  creditTransferTargetLabel,
  paymentOverpayment,
} from "./overpayment";

// QA D3-04: a move to another recipient names both recipients and the amount.
describe("credit transfer to another recipient", () => {
  const body = {
    error: "credit_transfer_recipient_mismatch",
    confirm_field: "confirm_recipient_mismatch",
    source_invoice_number: "INV-20261012-0002",
    source_recipient_name: "Herr Ben Muster",
    target_invoice_number: "INV-20261012-0009",
    target_recipient_name: "Beispiel GmbH",
    amount_gross: "30",
    currency: "EUR",
  };

  it("reads the mismatch details of the 409 and nothing else", () => {
    expect(creditTransferRecipientMismatch(body)).toEqual({
      sourceInvoiceNumber: "INV-20261012-0002",
      sourceRecipientName: "Herr Ben Muster",
      targetInvoiceNumber: "INV-20261012-0009",
      targetRecipientName: "Beispiel GmbH",
      amountGross: "30",
      currency: "EUR",
    });
    expect(creditTransferRecipientMismatch({ error: "payment_exceeds_balance" })).toBeNull();
    expect(creditTransferRecipientMismatch(null)).toBeNull();
  });

  it("asks with both recipients and the amount", () => {
    const mismatch = creditTransferRecipientMismatch(body)!;
    const ru = creditTransferMismatchQuestion(mismatch, "ru", (value, currency) => formatMoneyAmount(value, currency));
    expect(ru).toContain(formatMoneyAmount("30", "EUR"));
    expect(ru).toContain("Herr Ben Muster");
    expect(ru).toContain("Beispiel GmbH");
    expect(ru).toContain("INV-20261012-0009");
    const de = creditTransferMismatchQuestion(mismatch, "de", (value, currency) => formatMoneyAmount(value, currency));
    expect(de).toContain("Beispiel GmbH");
    expect(de).toContain("umgebucht");
  });

  it("shows the recipient of each target invoice", () => {
    const money = (value: unknown) => formatMoneyAmount(value, "EUR");
    const template = "{number} · {order} · к оплате {amount}";
    expect(
      creditTransferTargetLabel(
        { invoice_id: "1", invoice_number: "INV-9", invoice_type: "final", order_number: "A-1", balance_due: "113.05", recipient_name: "Beispiel GmbH", same_recipient: false },
        template,
        "ru",
        money,
      ),
    ).toBe(`INV-9 · A-1 · к оплате ${money("113.05")} · получатель: Beispiel GmbH (другой получатель)`);
    expect(
      creditTransferTargetLabel(
        { invoice_id: "2", invoice_number: "INV-8", invoice_type: "final", order_number: null, balance_due: "10", recipient_name: "Ben Muster", same_recipient: true },
        "{number} · {order} · offen {amount}",
        "de",
        money,
      ),
    ).toBe(`INV-8 · — · offen ${money("10")} · Empfänger: Ben Muster`);
  });
});

describe("overpayments", () => {
  it("reports the part of a receipt above the open balance", () => {
    expect(paymentOverpayment("1152.20", "452.20")).toBe(700);
    expect(paymentOverpayment("452.20", "452.20")).toBe(0);
    expect(paymentOverpayment("100", "0")).toBe(100);
    expect(paymentOverpayment("", "10")).toBe(0);
  });
});

describe("credit transfers", () => {
  it("proposes the credit up to the target balance", () => {
    expect(creditTransferDefaultAmount("700", "452.2")).toBe("452.20");
    expect(creditTransferDefaultAmount("100", "452.2")).toBe("100.00");
    expect(creditTransferDefaultAmount("100", undefined)).toBe("");
  });

  it("keeps a transfer within the credit and the target balance", () => {
    expect(creditTransferProblem("100", "700", "452.2")).toBeNull();
    expect(creditTransferProblem("0", "700", "452.2")).toBe("invalid_amount");
    expect(creditTransferProblem("700.01", "700", "800")).toBe("exceeds_credit");
    expect(creditTransferProblem("500", "700", "452.2")).toBe("exceeds_target");
    expect(creditTransferProblem("100", "700", undefined)).toBe("no_target");
  });
});
