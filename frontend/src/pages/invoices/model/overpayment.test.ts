import { describe, expect, it } from "vitest";

import { formatMoneyAmount } from "@/lib/money";

import { localizeInvoiceError } from "./invoice-errors";
import {
  creditTransferDefaultAmount,
  creditTransferProblem,
  creditTransferTargetLabel,
  creditTransferTargets,
  paymentOverpayment,
} from "./overpayment";

// Owner decision 2026-11-12 (QA L12): credit never moves to another person.
describe("credit transfer to another recipient", () => {
  it("offers only invoices of the same recipient person", () => {
    const own = { invoice_id: "2", invoice_number: "INV-8", invoice_type: "final", order_number: null, balance_due: "10", recipient_name: "Ben Muster", same_recipient: true };
    const other = { invoice_id: "1", invoice_number: "INV-9", invoice_type: "final", order_number: "A-1", balance_due: "113.05", recipient_name: "Beispiel GmbH", same_recipient: false };
    expect(creditTransferTargets([other, own])).toEqual([own]);
    expect(creditTransferTargets(undefined)).toEqual([]);
  });

  it("explains the server's refusal in the UI language", () => {
    const refusal = Object.assign(new Error("Credit can only be moved to an invoice of the same patient and the same invoice recipient"), {
      body: { error: "credit_transfer_other_person" },
      code: "credit_transfer_other_person",
    });
    expect(localizeInvoiceError(refusal, "de", "Fehler")).toContain("desselben Rechnungsempfängers");
    expect(localizeInvoiceError(refusal, "ru", "Ошибка")).toContain("того же получателя");
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
    expect(creditTransferDefaultAmount("700", "452.2")).toBe("452,20");
    expect(creditTransferDefaultAmount("100", "452.2")).toBe("100,00");
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
