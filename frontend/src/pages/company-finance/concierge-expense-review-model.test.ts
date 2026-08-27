import { describe, expect, it } from "vitest";

import {
  buildExpensePostPayload,
  eligibleExpenseOrderServices,
  filterConciergeExpenseQueue,
  resolveStableRequestId,
  validateExpensePostForm,
  validateExpenseRejection,
} from "./concierge-expense-review-model";
import type {
  CompanyConciergeExpenseContext,
  CompanyConciergeExpenseItem,
  CompanyConciergeServiceSummary,
  CompanyFinancialAccount,
} from "./types";

function expense(overrides: Partial<CompanyConciergeExpenseItem> = {}): CompanyConciergeExpenseItem {
  return {
    id: "expense-1",
    concierge_service_id: "service-1",
    patient_id: "patient-1",
    order_id: null,
    order_number: null,
    order_leistung_id: null,
    order_leistung_name: null,
    vendor: "Fahrdienst Berlin",
    expense_date: "2026-08-18",
    amount_net: "100.00",
    amount_vat: "19.00",
    amount_gross: "119.00",
    currency: "EUR",
    paid_by: "agency",
    service_delivered: true,
    note: null,
    status: "pending_review",
    submitted_by: { id: "user-1", display_name: "Concierge" },
    submitted_at: "2026-08-19T10:00:00Z",
    receipt: {
      document_id: "document-1",
      original_filename: "receipt.pdf",
      mime_type: "application/pdf",
      file_size: 1000,
      download_url: "/receipt",
    },
    external_invoice: null,
    balance_consequence: {
      posting_pending: true,
      patient_receivable_gross: "0.00",
      company_paid_gross: "0.00",
      provider_liability_gross: "0.00",
      intended_patient_receivable_gross: "119.00",
      intended_company_paid_gross: "119.00",
      intended_provider_liability_gross: "0.00",
    },
    history: [],
    ...overrides,
  };
}

const service: CompanyConciergeServiceSummary = {
  id: "service-1",
  patient_id: "patient-1",
  patient_name: "Anna Patient",
  patient_pid: "P-001",
  title: "Transfer",
  status: "completed",
  currency: "EUR",
  provider_id: "provider-1",
  provider_name: "Fahrdienst Berlin",
};

const context: CompanyConciergeExpenseContext = {
  patient: { id: "patient-1", display_name: "Anna Patient", pid: "P-001" },
  service: { id: "service-1", title: "Transfer", currency: "EUR", provider_id: "provider-1" },
  mapped_order: null,
  eligible_orders: [
    {
      id: "order-eur",
      order_number: "O-100",
      currency: "EUR",
      status: "active",
      leistungen: [
        { id: "line-match", name: "Transfer", description: null, provider_id: "provider-1" },
        { id: "line-other", name: "Other", description: null, provider_id: "provider-2" },
      ],
    },
    {
      id: "order-usd",
      order_number: "O-200",
      currency: "USD",
      status: "active",
      leistungen: [],
    },
  ],
};

const account: CompanyFinancialAccount = {
  id: "account-1",
  name: "Bank EUR",
  account_type: "bank",
  currency: "EUR",
  iban: null,
  opening_balance: "0.00",
  opening_balance_on: "2026-01-01",
  movement_balance: "0.00",
  adjustment_balance: "0.00",
  transfer_balance: "0.00",
  current_balance: "0.00",
  movement_count: 0,
  transfer_count: 0,
  latest_movement_on: null,
  is_default: true,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("Concierge expense finance review model", () => {
  it("filters the server-provided review queue by status, patient, or vendor", () => {
    const posted = expense({ id: "posted", status: "posted", submitted_at: "2026-08-20T10:00:00Z" });
    const pending = expense({ id: "pending", status: "pending_review" });
    const rows = [
      { ...pending, service },
      { ...posted, service },
    ];

    expect(filterConciergeExpenseQueue(rows, "pending_review", "anna")).toHaveLength(1);
    expect(filterConciergeExpenseQueue(rows, "all", "fahrdienst")).toHaveLength(2);
  });

  it("keeps order and service choices currency- and provider-safe", () => {
    expect(eligibleExpenseOrderServices(expense(), context, "order-eur").map((row) => row.id))
      .toEqual(["line-match"]);
    expect(eligibleExpenseOrderServices(expense(), context, "order-usd")).toEqual([]);
  });

  it("requires complete agency settlement fields and strips them for other payers", () => {
    const form = {
      orderId: "order-eur",
      orderLeistungId: "line-match",
      financialAccountId: "",
      paidOn: "",
      paymentMethod: "bank_transfer" as const,
      paymentReference: "",
    };
    expect(validateExpensePostForm(expense(), context, [account], form, "2026-08-20"))
      .toEqual(expect.arrayContaining([
        "paid_on_required",
        "financial_account_required",
        "payment_reference_required",
      ]));

    const patientExpense = expense({ paid_by: "patient" });
    expect(buildExpensePostPayload(patientExpense, {
      ...form,
      financialAccountId: "stale-account",
      paidOn: "2026-08-19",
      paymentReference: "stale reference",
    }, "request-1")).toMatchObject({
      financial_account_id: null,
      paid_on: null,
      payment_method: null,
      payment_reference: null,
    });
  });

  it("allows finance to post a Concierge expense without assigning an order", () => {
    const form = {
      orderId: "",
      orderLeistungId: "",
      financialAccountId: "account-1",
      paidOn: "2026-08-19",
      paymentMethod: "bank_transfer" as const,
      paymentReference: "BANK-OPTIONAL-ORDER",
    };

    expect(validateExpensePostForm(expense(), context, [account], form, "2026-08-20"))
      .toEqual([]);
    expect(buildExpensePostPayload(expense(), form, "request-orderless"))
      .toMatchObject({
        request_id: "request-orderless",
        order_id: null,
        order_leistung_id: null,
      });
  });

  it("reuses request ids only for an identical retry payload", () => {
    const registry = new Map();
    let counter = 0;
    const generate = () => `request-${++counter}`;
    expect(resolveStableRequestId(registry, "post:expense-1", { order: "a" }, generate))
      .toBe("request-1");
    expect(resolveStableRequestId(registry, "post:expense-1", { order: "a" }, generate))
      .toBe("request-1");
    expect(resolveStableRequestId(registry, "post:expense-1", { order: "b" }, generate))
      .toBe("request-2");
    expect(validateExpenseRejection("  missing receipt  ")).toBe(true);
    expect(validateExpenseRejection("   ")).toBe(false);
  });
});
