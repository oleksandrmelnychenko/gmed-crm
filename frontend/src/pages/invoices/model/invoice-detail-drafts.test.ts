import { describe, expect, it } from "vitest";

import {
  draftChanged,
  invoiceDetailHasUnsavedInput,
  newCreditNoteDraft,
  newPaymentDraft,
  newRefundDraft,
  type InvoiceDetailDraftState,
} from "./invoice-detail-drafts";

const today = "2026-09-25";

function pristine(balanceDue: unknown = "2963.10"): InvoiceDetailDraftState {
  const payment = newPaymentDraft(balanceDue, today);
  const creditNote = newCreditNoteDraft(today);
  const refund = newRefundDraft(today);
  const prepayment = { invoiceId: "advance-1", amount: "500.00" };
  return {
    payment: { draft: payment, baseline: payment },
    creditNote: { draft: creditNote, baseline: creditNote },
    refund: { draft: refund, baseline: refund },
    prepayment: { draft: prepayment, baseline: prepayment },
    reversalTexts: ["", "", ""],
    paymentCorrectionDirty: false,
  };
}

describe("newPaymentDraft", () => {
  it("proposes the open balance received today", () => {
    expect(newPaymentDraft("2963.1", today)).toMatchObject({
      amountGross: "2963.10",
      paymentMethod: "bank_transfer",
      receivedOn: today,
    });
    expect(newPaymentDraft("0", today).amountGross).toBe("");
    expect(newPaymentDraft(undefined, today).amountGross).toBe("");
  });
});

describe("invoiceDetailHasUnsavedInput", () => {
  it("treats the prefilled payment, credit-note, refund and prepayment forms as clean", () => {
    expect(invoiceDetailHasUnsavedInput(pristine())).toBe(false);
  });

  it("ignores request ids regenerated after a save", () => {
    const state = pristine();
    state.payment = { ...state.payment, draft: { ...state.payment.draft, requestId: "after-save" } };
    state.creditNote = {
      ...state.creditNote,
      draft: { ...newCreditNoteDraft(today) },
    };
    expect(invoiceDetailHasUnsavedInput(state)).toBe(false);
  });

  it("flags a changed payment amount or date", () => {
    const amount = pristine();
    amount.payment = { ...amount.payment, draft: { ...amount.payment.draft, amountGross: "1000" } };
    expect(invoiceDetailHasUnsavedInput(amount)).toBe(true);

    const date = pristine();
    date.payment = { ...date.payment, draft: { ...date.payment.draft, receivedOn: "2026-09-20" } };
    expect(invoiceDetailHasUnsavedInput(date)).toBe(true);
  });

  it("flags typed credit-note, refund and prepayment input", () => {
    const credit = pristine();
    credit.creditNote = { ...credit.creditNote, draft: { ...credit.creditNote.draft, reason: "Goodwill" } };
    expect(invoiceDetailHasUnsavedInput(credit)).toBe(true);

    const refund = pristine();
    refund.refund = { ...refund.refund, draft: { ...refund.refund.draft, amountGross: "50" } };
    expect(invoiceDetailHasUnsavedInput(refund)).toBe(true);

    const prepayment = pristine();
    prepayment.prepayment = { ...prepayment.prepayment, draft: { invoiceId: "advance-1", amount: "100" } };
    expect(invoiceDetailHasUnsavedInput(prepayment)).toBe(true);
  });

  it("flags reversal reasons and an edited payment correction", () => {
    expect(invoiceDetailHasUnsavedInput({ ...pristine(), reversalTexts: ["", "Wrong amount", ""] })).toBe(true);
    expect(invoiceDetailHasUnsavedInput({ ...pristine(), paymentCorrectionDirty: true })).toBe(true);
  });

  it("is clean again once an edit is reverted or saved as the new baseline", () => {
    const state = pristine();
    const typed = { ...state.payment.draft, amountGross: "1000" };
    expect(draftChanged({ draft: { ...typed, amountGross: "2963.10" }, baseline: state.payment.baseline })).toBe(false);
    expect(draftChanged({ draft: typed, baseline: typed })).toBe(false);
  });
});
