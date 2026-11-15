import { describe, expect, it } from "vitest";

import {
  portalCreditSideLabel,
  resolvePatientBalancePresentation,
  staffBalanceWithoutUnappliedAdvance,
  staffCreditSideLabel,
} from "./account-balance";

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

  // QA 2026-11-13 F-x6: a payer's open 550 € invoice is not the patient's debt.
  it("leaves a third party's open invoice out of the patient's own balance", () => {
    expect(
      resolvePatientBalancePresentation({
        closing_balance: "550.00",
        balance_side: "debit",
        third_party_open_due: "550.00",
      }),
    ).toEqual({ amount: 0, side: "settled", needsReconciliation: false, thirdPartyDue: 550 });
    expect(
      resolvePatientBalancePresentation({
        closing_balance: "650.00",
        balance_side: "debit",
        third_party_open_due: "550",
      }),
    ).toEqual({ amount: 100, side: "debit", needsReconciliation: false, thirdPartyDue: 550 });
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

describe("staffBalanceWithoutUnappliedAdvance (QA 2026-11-15, A-3)", () => {
  it("counts only the cash above an unapplied advance as overpayment", () => {
    const summary = { closing_balance: "-1027.33", balance_side: "credit" as const, available_prepayment: "1000.00" };
    const balance = staffBalanceWithoutUnappliedAdvance(resolvePatientBalancePresentation(summary), summary);
    expect(balance).toMatchObject({ amount: 27.33, side: "credit" });
    expect(staffCreditSideLabel(summary, "ru")).toBe("Переплата");
  });
  it("leaves a credit the advance covers and a debt as they are", () => {
    const advanceOnly = { closing_balance: "-1000.00", balance_side: "credit" as const, available_prepayment: "1000.00" };
    expect(staffBalanceWithoutUnappliedAdvance(resolvePatientBalancePresentation(advanceOnly), advanceOnly)).toMatchObject({ amount: 1000 });
    const debt = { closing_balance: "50.00", balance_side: "debit" as const, available_prepayment: "1000.00" };
    expect(staffBalanceWithoutUnappliedAdvance(resolvePatientBalancePresentation(debt), debt)).toMatchObject({ amount: 50, side: "debit" });
  });
});
