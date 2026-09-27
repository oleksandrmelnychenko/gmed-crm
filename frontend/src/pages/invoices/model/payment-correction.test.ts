import { describe, expect, it } from "vitest";

import { canPickInvoiceStatus } from "./invoice-model";
import {
  buildPaymentCorrectionPayload,
  canCorrectPayment,
  paymentCorrectionOverpayment,
  paymentCorrectionProblem,
  type PaymentCorrectionForm,
} from "./payment-correction";

const payment = {
  transaction_type: "payment" as const,
  is_reversed: false,
  amount_gross: "100.00",
  payment_method: "bank_transfer",
  payment_reference: "REF-1",
  received_on: "2026-09-01",
  note: null,
};

const form: PaymentCorrectionForm = {
  requestId: "request",
  amountGross: "100.00",
  paymentMethod: "bank_transfer",
  paymentReference: "REF-1",
  receivedOn: "2026-09-01",
  note: "",
  reason: "",
};

describe("payment correction", () => {
  it("only offers editing for live API receipts on active invoices", () => {
    expect(canCorrectPayment(payment, "partially_paid")).toBe(true);
    expect(canCorrectPayment(payment, "cancelled")).toBe(false);
    expect(canCorrectPayment({ ...payment, is_reversed: true }, "paid")).toBe(false);
    expect(canCorrectPayment({ ...payment, transaction_type: "reversal" }, "paid")).toBe(false);
    expect(canCorrectPayment({ ...payment, payment_method: "legacy_import" }, "paid")).toBe(false);
    expect(canCorrectPayment({ ...payment, payment_method: "credit_transfer" }, "paid")).toBe(false);
  });

  it("requires a real change and a reason", () => {
    expect(paymentCorrectionProblem(form, payment)).toBe("unchanged");
    expect(paymentCorrectionProblem({ ...form, amountGross: "120" }, payment)).toBe("missing_reason");
    expect(paymentCorrectionProblem({ ...form, amountGross: "0", reason: "typo" }, payment)).toBe("invalid_amount");
    expect(paymentCorrectionProblem({ ...form, amountGross: "120", reason: "typo" }, payment)).toBeNull();
  });

  it("records a corrected receipt above the open balance as a confirmed overpayment", () => {
    const corrected = { ...form, amountGross: "151", reason: "typo" };
    expect(paymentCorrectionProblem(corrected, payment)).toBeNull();
    expect(paymentCorrectionOverpayment(corrected, 150)).toBe(1);
    expect(paymentCorrectionOverpayment({ ...corrected, amountGross: "150" }, 150)).toBe(0);
    expect(buildPaymentCorrectionPayload(corrected, 150).accept_overpayment).toBe(true);
    expect(buildPaymentCorrectionPayload({ ...corrected, amountGross: "120" }, 150).accept_overpayment).toBe(false);
  });

  it("normalises blank optional fields in the payload", () => {
    expect(buildPaymentCorrectionPayload({ ...form, paymentReference: " ", reason: " typo " })).toEqual({
      request_id: "request",
      amount_gross: 100,
      payment_method: "bank_transfer",
      payment_reference: null,
      received_on: "2026-09-01",
      note: null,
      reason: "typo",
      accept_overpayment: false,
    });
  });
});

describe("invoice status transitions", () => {
  it("mirrors the manual transitions accepted by the API", () => {
    expect(canPickInvoiceStatus("draft", "sent")).toBe(true);
    expect(canPickInvoiceStatus("draft", "overdue")).toBe(false);
    expect(canPickInvoiceStatus("sent", "paid")).toBe(false);
    expect(canPickInvoiceStatus("paid", "draft")).toBe(false);
    expect(canPickInvoiceStatus("overdue", "sent")).toBe(true);
    expect(canPickInvoiceStatus("cancelled", "sent")).toBe(false);
    expect(canPickInvoiceStatus("cancelled", "cancelled")).toBe(true);
  });
});
