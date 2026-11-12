import { describe, expect, it } from "vitest";

import {
  CONCIERGE_EXPENSE_MAX_FILE_SIZE,
  actualCostMismatch,
  calculateConciergeExpenseGross,
  conciergeExpenseSubmitErrorMessage,
  calculateConciergeExpenseNetFromGross,
  calculateConciergeExpenseVat,
  calculateConciergeExpenseVatFromGross,
  conciergeExpenseConsequencePreview,
  expenseDecisionReason,
  postedReceiptTotals,
  moneyStringToMinorUnits,
  readsServiceReceipts,
  validateConciergeExpenseReceiptFile,
} from "./expense-receipt-model";

describe("Concierge expense receipt model", () => {
  it("validates camera images and PDFs without trusting an unsupported MIME type", () => {
    expect(validateConciergeExpenseReceiptFile({
      name: "taxi-receipt.jpg",
      size: 2_400,
      type: "image/jpeg",
    })).toBeNull();
    expect(validateConciergeExpenseReceiptFile({
      name: "hotel.pdf",
      size: 8_000,
      type: "application/octet-stream",
    })).toBeNull();
    expect(validateConciergeExpenseReceiptFile({
      name: "receipt.svg",
      size: 8_000,
      type: "image/svg+xml",
    })).toBe("unsupported_type");
    expect(validateConciergeExpenseReceiptFile({
      name: "huge.pdf",
      size: CONCIERGE_EXPENSE_MAX_FILE_SIZE + 1,
      type: "application/pdf",
    })).toBe("too_large");
    expect(validateConciergeExpenseReceiptFile(null)).toBe("required");
  });

  it("uses exact minor units and calculates VAT from a percentage", () => {
    expect(moneyStringToMinorUnits("12,30")).toBe(1_230);
    expect(moneyStringToMinorUnits("0.07")).toBe(7);
    // German thousands dots (owner 2026-11-11): "12.345" is 12.345,00 €; three decimals are refused.
    expect(moneyStringToMinorUnits("12.345")).toBe(1_234_500);
    expect(moneyStringToMinorUnits("1.234,56")).toBe(123_456);
    expect(moneyStringToMinorUnits("12,345")).toBeNull();
    expect(calculateConciergeExpenseGross("100.00", "19.00")).toBe("119.00");
    expect(calculateConciergeExpenseVat("12.30", "7.5")).toBe("0.92");
    expect(calculateConciergeExpenseGross("12.30", "7.5")).toBe("13.22");
    expect(calculateConciergeExpenseNetFromGross("119.00", "19")).toBe("100.00");
    expect(calculateConciergeExpenseVatFromGross("119.00", "19")).toBe("19.00");
    expect(calculateConciergeExpenseNetFromGross("13.22", "7.5")).toBe("12.30");
    expect(calculateConciergeExpenseVatFromGross("13.22", "7.5")).toBe("0.92");
    expect(calculateConciergeExpenseGross("100.00", "101")).toBe("");
    expect(calculateConciergeExpenseGross("", "19.00")).toBe("");
  });

  it("previews balance effects only for the later financial approval", () => {
    expect(conciergeExpenseConsequencePreview("patient", true, "119.00")).toEqual({
      patientReceivableGross: "0.00",
      providerLiabilityGross: "0.00",
      companyPaidGross: "0.00",
    });
    expect(conciergeExpenseConsequencePreview("agency", true, "119.00")).toEqual({
      patientReceivableGross: "119.00",
      providerLiabilityGross: "0.00",
      companyPaidGross: "119.00",
    });
    expect(conciergeExpenseConsequencePreview("unpaid", false, "119.00")).toEqual({
      patientReceivableGross: "119.00",
      providerLiabilityGross: "119.00",
      companyPaidGross: "0.00",
      patientReceivableAfterDelivery: true,
    });
    expect(conciergeExpenseConsequencePreview("unpaid", true, "119.00")).toEqual({
      patientReceivableGross: "119.00",
      providerLiabilityGross: "119.00",
      companyPaidGross: "0.00",
      patientReceivableAfterDelivery: false,
    });
  });
});

describe("Concierge receipt decisions and posted totals (QA 2026-11-12)", () => {
  it("shows the reason of the latest rejection or storno only", () => {
    const history = [
      { action: "submitted" as const, actor: null, reason: null, created_at: "2026-11-12T10:00:00Z" },
      { action: "posted" as const, actor: null, reason: null, created_at: "2026-11-12T11:00:00Z" },
      { action: "reversed" as const, actor: null, reason: "  Doppelt erfasst  ", created_at: "2026-11-12T12:00:00Z" },
    ];
    expect(expenseDecisionReason({ status: "reversed", history })).toBe("Doppelt erfasst");
    expect(expenseDecisionReason({ status: "posted", history })).toBeNull();
    expect(expenseDecisionReason({
      status: "rejected",
      history: [{ action: "rejected", actor: null, reason: "Beleg unleserlich", created_at: null }],
    })).toBe("Beleg unleserlich");
    expect(expenseDecisionReason({ status: "rejected" })).toBeNull();
  });

  it("totals posted receipts and warns when the typed actual cost matches neither net nor gross", () => {
    const totals = postedReceiptTotals([
      { status: "posted", amount_net: "85.50", amount_gross: "101.75" },
      { status: "rejected", amount_net: "25.00", amount_gross: "26.75" },
      { status: "reversed", amount_net: "25.00", amount_gross: "26.75" },
      { status: "posted", amount_net: "120.00", amount_gross: "142.80" },
    ]);
    expect(totals).toEqual({ count: 2, netCents: 20550, grossCents: 24455 });
    expect(actualCostMismatch(205.5, totals)).toBe(false);
    expect(actualCostMismatch(244.55, totals)).toBe(false);
    expect(actualCostMismatch(10, totals)).toBe(true);
    expect(actualCostMismatch(Number.NaN, totals)).toBe(false);
    expect(actualCostMismatch(10, { count: 0, netCents: 0, grossCents: 0 })).toBe(false);
  });

  it("reads a service's receipts only for the roles the server lets read them", () => {
    expect(readsServiceReceipts("ceo", "u1", null)).toBe(true);
    expect(readsServiceReceipts("billing", "u1", null)).toBe(true);
    expect(readsServiceReceipts("ceo_assistant", "u1", null)).toBe(true);
    expect(readsServiceReceipts("concierge", "u1", "u1")).toBe(true);
    expect(readsServiceReceipts("concierge", "u1", "u2")).toBe(false);
    expect(readsServiceReceipts("concierge", "u1", null)).toBe(false);
    expect(readsServiceReceipts("patient_manager", "u1", "u1")).toBe(false);
    expect(readsServiceReceipts(undefined, undefined, undefined)).toBe(false);
  });

  it("translates the duplicate receipt refusal and keeps other server texts", () => {
    const duplicate = Object.assign(new Error("This receipt was already submitted"), {
      code: "concierge_expense_duplicate_receipt",
    });
    expect(conciergeExpenseSubmitErrorMessage(duplicate, "ru", "x")).toBe(
      "Этот чек уже отправлен по этой задаче или услуге Concierge.",
    );
    expect(conciergeExpenseSubmitErrorMessage(duplicate, "de", "x")).toContain("bereits eingereicht");
    expect(conciergeExpenseSubmitErrorMessage(new Error("Other"), "ru", "x")).toBe("Other");
    expect(conciergeExpenseSubmitErrorMessage(null, "ru", "fallback")).toBe("fallback");
  });
});
