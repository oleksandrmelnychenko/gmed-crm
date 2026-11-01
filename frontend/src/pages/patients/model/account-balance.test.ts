import { describe, expect, it } from "vitest";

import { portalCreditSideLabel, resolvePatientBalancePresentation, staffCreditSideLabel } from "./account-balance";

describe("portalCreditSideLabel", () => {
  it("calls a paid advance a prepayment, not an overpayment", () => {
    const part = { closing_balance: "-400.00", available_prepayment: "400.00" };
    expect(portalCreditSideLabel(part, "ru")).toBe("предоплата");
    expect(portalCreditSideLabel(part, "de")).toBe("Vorauszahlung");
  });
  it("keeps the overpayment word for a real credit", () => {
    expect(portalCreditSideLabel({ closing_balance: "-50", available_prepayment: "0" }, "ru")).toBe("переплата");
    expect(portalCreditSideLabel({ closing_balance: "-500", available_prepayment: "400" }, "de")).toBe("Guthaben");
  });
});

describe("staffCreditSideLabel", () => {
  it("calls a paid part of an advance a prepayment in the staff header", () => {
    const part = { closing_balance: "-400.00", available_prepayment: "400.00" };
    expect(staffCreditSideLabel(part, "ru")).toBe("Предоплата");
    expect(staffCreditSideLabel(part, "de")).toBe("Vorauszahlung");
  });
  it("keeps the overpayment word for a real credit or no statement", () => {
    expect(staffCreditSideLabel({ closing_balance: "-50", available_prepayment: "0" }, "ru")).toBe("Переплата");
    expect(staffCreditSideLabel(null, "de")).toBe("Guthaben");
  });
});

describe("resolvePatientBalancePresentation", () => {
  it("shows a positive closing balance as patient debit", () => {
    expect(
      resolvePatientBalancePresentation({
        calculated_balance: "450.00",
        closing_balance: "450.00",
        balance_side: "debit",
      }),
    ).toEqual({ amount: 450, side: "debit", needsReconciliation: false });
  });

  it("shows a negative closing balance as patient credit", () => {
    expect(
      resolvePatientBalancePresentation({
        calculated_balance: "-125.50",
        closing_balance: "-125.50",
        balance_side: "credit",
      }),
    ).toEqual({ amount: 125.5, side: "credit", needsReconciliation: false });
  });

  it("hides the calculated figure while reconciliation is required", () => {
    expect(
      resolvePatientBalancePresentation({
        calculated_balance: "2050.00",
        closing_balance: null,
        balance_side: "reconciliation_required",
      }),
    ).toEqual({ amount: null, side: "reconciliation_required", needsReconciliation: true });
  });

  it("shows the staff figure next to the open reconciliation (QA 2026-10-31)", () => {
    expect(
      resolvePatientBalancePresentation({
        closing_balance: null,
        provisional_balance: "-125.50",
        balance_side: "reconciliation_required",
      }),
    ).toEqual({
      amount: 125.5,
      signedAmount: -125.5,
      side: "reconciliation_required",
      needsReconciliation: true,
    });
  });

  it("does not render an invalid balance", () => {
    expect(
      resolvePatientBalancePresentation({
        calculated_balance: "450.00",
        closing_balance: "not-a-number",
        balance_side: "debit",
      }),
    ).toBeNull();
  });

  it.each([undefined, null, [], {}, { closing_balance: "450.00" }])(
    "does not crash on a malformed summary: %j",
    (summary) => {
      expect(resolvePatientBalancePresentation(summary)).toBeNull();
    },
  );

  it("does not interpret an empty balance as zero", () => {
    expect(
      resolvePatientBalancePresentation({
        closing_balance: " ",
        balance_side: "settled",
      }),
    ).toBeNull();
  });
});
