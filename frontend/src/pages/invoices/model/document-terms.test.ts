import { describe, expect, it } from "vitest";

import {
  blankReceivedPayment,
  createDocumentTermsPayload,
  periodSuggestionLabel,
  periodSuggestions,
  quotePeriodDefaults,
  receivedPaymentExcess,
  receivedPaymentExcessText,
  receivedPaymentIsPartial,
  receivedPaymentPayload,
  receivedPaymentProblem,
  servicePeriodPayload,
  servicePeriodProblem,
} from "./document-terms";
import { draftFormDirty, draftFormFrom, draftUpdatePayload, type DraftEditorPayload } from "./draft-editor";
import { releaseDueDateState } from "./invoice-model";

const today = "2026-11-17";

describe("money received before the invoice", () => {
  it("is not sent unless ticked", () => {
    expect(receivedPaymentPayload(blankReceivedPayment())).toBeNull();
    expect(receivedPaymentProblem(blankReceivedPayment(), 2000, today)).toBeNull();
  });

  it("takes the invoice total when no amount is typed", () => {
    const form = { ...blankReceivedPayment(), enabled: true, receivedOn: "2026-11-15" };
    expect(receivedPaymentProblem(form, 2000, today)).toBeNull();
    expect(receivedPaymentPayload(form)).toEqual({ received_on: "2026-11-15", amount_gross: null, payment_method: "bank_transfer" });
    expect(receivedPaymentIsPartial(form, 2000)).toBe(false);
  });

  it("sends a typed part payment in the API notation", () => {
    const form = { ...blankReceivedPayment(), enabled: true, receivedOn: "2026-11-15", amount: "1.500,00", method: "cash" };
    expect(receivedPaymentPayload(form)).toEqual({ received_on: "2026-11-15", amount_gross: "1500.00", payment_method: "cash" });
    expect(receivedPaymentIsPartial(form, 2000)).toBe(true);
  });

  it("refuses a missing or future day, a bad amount and a method outside the journal", () => {
    const ticked = { ...blankReceivedPayment(), enabled: true, receivedOn: "2026-11-15" };
    expect(receivedPaymentProblem({ ...ticked, receivedOn: "" }, 100, today)).toBe("missing_date");
    expect(receivedPaymentProblem({ ...ticked, receivedOn: "2026-11-18" }, 100, today)).toBe("future_date");
    expect(receivedPaymentProblem({ ...ticked, amount: "0" }, 100, today)).toBe("invalid_amount");
    expect(receivedPaymentProblem({ ...ticked, amount: "abc" }, 100, today)).toBe("invalid_amount");
    expect(receivedPaymentProblem({ ...ticked, method: "crypto" }, 100, today)).toBe("invalid_method");
  });
});

describe("service period", () => {
  const defaults = quotePeriodDefaults({ order_period_from: "2026-11-20", order_period_to: "2026-11-25" });

  it("proposes the order's planned period and sends only a changed one", () => {
    expect(defaults).toEqual({ from: "2026-11-20", to: "2026-11-25" });
    expect(servicePeriodPayload(defaults, defaults)).toBeNull();
    expect(servicePeriodPayload({ from: "2026-11-21", to: "2026-11-25" }, defaults)).toEqual({ from: "2026-11-21", to: "2026-11-25" });
    // Only the end known: «bis MM.YYYY».
    expect(servicePeriodPayload({ from: "", to: "2026-12-31" }, defaults)).toEqual({ from: null, to: "2026-12-31" });
  });

  it("needs an end not before the start", () => {
    expect(servicePeriodProblem({ from: "", to: "" })).toBeNull();
    expect(servicePeriodProblem({ from: "2026-11-20", to: "" })).toBe("missing_end");
    expect(servicePeriodProblem({ from: "2026-11-26", to: "2026-11-25" })).toBe("end_before_start");
  });

  it("goes with a new invoice beside the received payment", () => {
    const form = {
      receivedPayment: { ...blankReceivedPayment(), enabled: true, receivedOn: "2026-11-15" },
      servicePeriod: null,
    };
    expect(createDocumentTermsPayload(form)).toEqual({
      payment_received: { received_on: "2026-11-15", amount_gross: null, payment_method: "bank_transfer" },
    });
    expect(createDocumentTermsPayload({ ...form, servicePeriod: { from: "2026-11-20", to: "2026-11-26" } }).service_period)
      .toEqual({ from: "2026-11-20", to: "2026-11-26" });
    // A period taken from the pills is staff's choice too (QA 2026-11-19 S2).
    expect(createDocumentTermsPayload({ ...form, servicePeriod: defaults }).service_period)
      .toEqual({ from: "2026-11-20", to: "2026-11-25" });
  });

  it("offers the programme and, apart, the first and last visit", () => {
    const quote = {
      order_programme_from: "2026-11-23",
      order_programme_to: "2026-12-04",
      order_visits_from: "2026-11-19",
      order_visits_to: "2026-12-04",
    };
    expect(periodSuggestions(quote, "from")).toEqual([
      { kind: "programme", edge: "from", date: "2026-11-23" },
      { kind: "visits", edge: "from", date: "2026-11-19" },
    ]);
    // The same day is offered once, as the programme's.
    expect(periodSuggestions(quote, "to")).toEqual([{ kind: "programme", edge: "to", date: "2026-12-04" }]);
    expect(periodSuggestions(null, "from")).toEqual([]);
    expect(periodSuggestionLabel({ kind: "programme", edge: "from", date: "" }, false)).toBe("Начало программы");
    expect(periodSuggestionLabel({ kind: "visits", edge: "to", date: "" }, false)).toBe("Последний приём");
  });
});

describe("draft editor", () => {
  const payload: DraftEditorPayload = {
    invoice_id: "inv-1",
    invoice_type: "advance",
    due_date: null,
    notes: null,
    lines_mode: "locked",
    lines_locked_reason: "other_sources",
    quote_lines: [],
    advance: null,
    payment_term_days: 14,
    payment_received: null,
    service_period: null,
    service_period_default: { from: "2026-11-20", to: "2026-11-25" },
  };

  it("shows the default period and sends nothing while it stays", () => {
    const form = draftFormFrom(payload);
    expect(form.servicePeriod).toEqual({ from: "2026-11-20", to: "2026-11-25" });
    expect(draftFormDirty(payload, form)).toBe(false);
    expect(draftUpdatePayload(payload, form)).toEqual({ due_date: null, notes: null });
  });

  it("sends a ticked payment and a changed period, null for the default again", () => {
    const form = draftFormFrom(payload);
    form.receivedPayment = { enabled: true, receivedOn: "2026-11-15", amount: "500", method: "card" };
    form.servicePeriod = { from: "", to: "2026-12-31" };
    expect(draftUpdatePayload(payload, form)).toMatchObject({
      payment_received: { received_on: "2026-11-15", amount_gross: "500", payment_method: "card" },
      service_period: { from: null, to: "2026-12-31" },
    });
    const stored = { ...payload, service_period: { from: null, to: "2026-12-31" } };
    const back = draftFormFrom(stored);
    back.servicePeriod = { from: "2026-11-20", to: "2026-11-25" };
    expect(draftUpdatePayload(stored, back).service_period).toBeNull();
  });

  it("unticking removes the noted payment", () => {
    const stored = { ...payload, payment_received: { received_on: "2026-11-15", amount_gross: "2000.00", payment_method: "bank_transfer" } };
    const form = draftFormFrom(stored);
    // German money format in the editor (QA verify2 B-5).
    expect(form.receivedPayment.amount).toBe("2.000,00");
    expect(draftFormDirty(stored, form)).toBe(false);
    form.receivedPayment = { ...form.receivedPayment, enabled: false };
    expect(draftUpdatePayload(stored, form).payment_received).toBeNull();
  });

  it("an amount left open stays open: the release takes what is due (QA verify2 B-2)", () => {
    const stored = { ...payload, payment_received: { received_on: "2026-11-15", amount_gross: null, payment_method: "cash" } };
    const form = draftFormFrom(stored);
    expect(form.receivedPayment.amount).toBe("");
    expect(draftFormDirty(stored, form)).toBe(false);
    const ticked = { ...blankReceivedPayment(), enabled: true, receivedOn: "2026-11-15" };
    expect(receivedPaymentProblem(ticked, 0, today)).toBeNull();
    expect(receivedPaymentExcess(ticked, 1144.91)).toBe(0);
  });

  it("names the excess of a typed amount above what is due (QA verify2 B-5)", () => {
    const typed = { ...blankReceivedPayment(), enabled: true, receivedOn: "2026-11-15", amount: "2.500,00" };
    expect(receivedPaymentExcess(typed, 2144.91)).toBe(355.09);
    expect(receivedPaymentExcess({ ...typed, amount: "2144,91" }, 2144.91)).toBe(0);
    expect(receivedPaymentExcess(typed, null)).toBe(0);
    expect(receivedPaymentExcessText("2.144,91 €", "355,09 €", false)).toContain("355,09 €");
  });
});

describe("due date of a draft", () => {
  it("is empty by default: the release sets invoice date + term", () => {
    const state = releaseDueDateState("", new Date("2026-11-17T10:00:00Z"), 14);
    expect(state).toMatchObject({ defaultDate: "2026-12-01", empty: true, shorterThanTerm: false });
  });

  it("keeps a typed date and marks one shorter than the term", () => {
    const now = new Date("2026-11-17T10:00:00Z");
    expect(releaseDueDateState("2026-11-30", now, 14).shorterThanTerm).toBe(true);
    expect(releaseDueDateState("2026-12-05", now, 14).shorterThanTerm).toBe(false);
    expect(releaseDueDateState("2026-11-25", now, 7).shorterThanTerm).toBe(false);
  });
});
