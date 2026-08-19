import { describe, expect, it } from "vitest";

import { resolvePatientBalancePresentation } from "./account-balance";

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

  it("keeps the calculated figure visible while reconciliation is required", () => {
    expect(
      resolvePatientBalancePresentation({
        calculated_balance: "2050.00",
        closing_balance: null,
        balance_side: "reconciliation_required",
      }),
    ).toEqual({ amount: 2050, side: "debit", needsReconciliation: true });
  });

  it("does not render an invalid balance", () => {
    expect(
      resolvePatientBalancePresentation({
        calculated_balance: "not-a-number",
        closing_balance: null,
        balance_side: "reconciliation_required",
      }),
    ).toBeNull();
  });
});
