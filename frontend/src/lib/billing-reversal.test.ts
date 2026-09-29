import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/lib/api";

import {
  type BillingReversalPreview,
  billingReversalBlockedMessage,
  billingReversalEffect,
  billingReversalErrorMessage,
  billingReversalNeedsFinanceRole,
  billingReversalSuccessMessage,
  isValidBillingReversalReason,
} from "./billing-reversal";

const ru = (ruText: string) => ruText;
const de = (_ruText: string, deText: string) => deText;

function preview(overrides: Partial<BillingReversalPreview> = {}): BillingReversalPreview {
  return {
    order_leistung_id: "line-1",
    order_id: "order-1",
    status: "approved",
    description: "Transfer",
    quantity: "1",
    line_gross: "119.00",
    currency: "EUR",
    draft_invoice_ids: [],
    requires_credit_note: false,
    credit_total_gross: "0.00",
    credit_notes: [],
    blocked_reason: null,
    ...overrides,
  };
}

describe("billing reversal texts", () => {
  it("explains a plain cancellation and a credit note with amount and invoice", () => {
    expect(billingReversalEffect(preview(), de)).toContain("ohne Gutschrift");
    const invoiced = preview({
      status: "invoiced",
      requires_credit_note: true,
      credit_total_gross: "119.00",
      credit_notes: [
        {
          invoice_id: "invoice-1",
          invoice_number: "RE-2026-0001",
          line_indexes: [0],
          amount_gross: "119.00",
          currency: "EUR",
        },
      ],
    });
    const text = billingReversalEffect(invoiced, ru);
    expect(text).toContain("кредит-нота");
    expect(text).toContain("RE-2026-0001");
    expect(text).toMatch(/119,00/);
  });

  it("names why a cancellation is blocked", () => {
    expect(billingReversalBlockedMessage(preview(), de)).toBeNull();
    expect(
      billingReversalBlockedMessage(preview({ blocked_reason: "order_service_on_draft_invoice" }), de),
    ).toContain("Rechnungsentwurf");
    expect(
      billingReversalBlockedMessage(preview({ blocked_reason: "order_service_already_cancelled" }), ru),
    ).toContain("уже отменена");
  });

  it("requires a finance role only for credit notes", () => {
    expect(billingReversalNeedsFinanceRole(preview(), false)).toBe(false);
    expect(billingReversalNeedsFinanceRole(preview({ requires_credit_note: true }), false)).toBe(true);
    expect(billingReversalNeedsFinanceRole(preview({ requires_credit_note: true }), true)).toBe(false);
  });

  it("reports the issued credit note numbers", () => {
    expect(billingReversalSuccessMessage([], de)).toBe("Leistung storniert.");
    expect(
      billingReversalSuccessMessage(
        [
          {
            credit_note_transaction_id: "cn-1",
            document_number: "CN-2026-000012",
            invoice_id: "invoice-1",
            invoice_number: "RE-1",
            amount_gross: "119.00",
            currency: "EUR",
          },
        ],
        de,
      ),
    ).toContain("CN-2026-000012");
  });

  it("validates reasons like the server", () => {
    expect(isValidBillingReversalReason("  ab ")).toBe(false);
    expect(isValidBillingReversalReason("abc")).toBe(true);
    expect(isValidBillingReversalReason("x".repeat(1001))).toBe(false);
  });

  it("localizes server refusals", () => {
    const refusal = (status: number, code: string) =>
      new ApiRequestError("server text", { status, body: { code } });
    expect(
      billingReversalErrorMessage(refusal(403, "order_service_reversal_requires_finance"), de),
    ).toContain("Gutschriften");
    expect(
      billingReversalErrorMessage(refusal(409, "order_service_on_draft_invoice"), ru),
    ).toContain("черновик");
    expect(billingReversalErrorMessage(new ApiRequestError("x", { status: 422 }), de)).toContain(
      "3–1000",
    );
    expect(billingReversalErrorMessage(new Error("boom"), ru)).toBe("Не удалось выполнить отмену.");
  });
});
