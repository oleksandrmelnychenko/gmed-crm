import { useCallback, useState, type SetStateAction } from "react";

import { hasFormChanges } from "@/lib/form-changes";

export type InvoicePaymentDraft = {
  requestId: string;
  amountGross: string;
  paymentMethod: string;
  paymentReference: string;
  receivedOn: string;
  note: string;
};

export type InvoiceCreditNoteDraft = {
  requestId: string;
  amountGross: string;
  reason: string;
  issuedOn: string;
  portalVisible: boolean;
};

export type InvoiceRefundDraft = {
  requestId: string;
  amountGross: string;
  paymentMethod: string;
  paymentReference: string;
  refundedOn: string;
  reason: string;
  note: string;
};

export type InvoicePrepaymentDraft = {
  invoiceId: string;
  amount: string;
};

/** A form draft together with the values the page filled in itself. */
export type DraftWithBaseline<T> = {
  draft: T;
  baseline: T;
};

export function isoToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** The payment form proposes the open balance, received today. */
export function newPaymentDraft(balanceDue: unknown, today = isoToday()): InvoicePaymentDraft {
  const balance = Number(balanceDue ?? 0);
  return {
    requestId: crypto.randomUUID(),
    amountGross: Number.isFinite(balance) && balance > 0 ? balance.toFixed(2) : "",
    paymentMethod: "bank_transfer",
    paymentReference: "",
    receivedOn: today,
    note: "",
  };
}

export function newCreditNoteDraft(today = isoToday()): InvoiceCreditNoteDraft {
  return {
    requestId: crypto.randomUUID(),
    amountGross: "",
    reason: "",
    issuedOn: today,
    portalVisible: true,
  };
}

export function newRefundDraft(today = isoToday()): InvoiceRefundDraft {
  return {
    requestId: crypto.randomUUID(),
    amountGross: "",
    paymentMethod: "bank_transfer",
    paymentReference: "",
    refundedOn: today,
    reason: "",
    note: "",
  };
}

function withoutRequestId(value: object) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "requestId"));
}

/**
 * Whether the user changed a draft away from what the page prefilled. The
 * request id is regenerated after every save and is not user input.
 */
export function draftChanged<T extends object>({ draft, baseline }: DraftWithBaseline<T>) {
  return hasFormChanges(withoutRequestId(draft), withoutRequestId(baseline));
}

export type InvoiceDetailDraftState = {
  payment: DraftWithBaseline<InvoicePaymentDraft>;
  creditNote: DraftWithBaseline<InvoiceCreditNoteDraft>;
  refund: DraftWithBaseline<InvoiceRefundDraft>;
  prepayment: DraftWithBaseline<InvoicePrepaymentDraft>;
  /** Free-text reasons typed for a reversal that has not been submitted. */
  reversalTexts: readonly string[];
  paymentCorrectionDirty: boolean;
};

/**
 * Decides whether closing the invoice detail sheet discards user input. The
 * prefilled payment amount and dates, and forms that were just saved, are not
 * unsaved changes.
 */
export function invoiceDetailHasUnsavedInput(state: InvoiceDetailDraftState) {
  return (
    draftChanged(state.payment) ||
    draftChanged(state.creditNote) ||
    draftChanged(state.refund) ||
    draftChanged(state.prepayment) ||
    state.reversalTexts.some((text) => text !== "") ||
    state.paymentCorrectionDirty
  );
}

function resolve<T>(next: SetStateAction<T>, current: T): T {
  return typeof next === "function" ? (next as (previous: T) => T)(current) : next;
}

/**
 * Form state whose programmatic (re)fills also move the baseline, so only the
 * user's own edits make it differ. `setDraft` records user edits; `resetDraft`
 * prefills or marks the current values as saved.
 */
export function useDraftWithBaseline<T>(create: () => T) {
  const [state, setState] = useState<DraftWithBaseline<T>>(() => {
    const initial = create();
    return { draft: initial, baseline: initial };
  });
  const setDraft = useCallback((next: SetStateAction<T>) => {
    setState((current) => ({ ...current, draft: resolve(next, current.draft) }));
  }, []);
  const resetDraft = useCallback((next: SetStateAction<T>) => {
    setState((current) => {
      const value = resolve(next, current.draft);
      return { draft: value, baseline: value };
    });
  }, []);
  return [state, setDraft, resetDraft] as const;
}
