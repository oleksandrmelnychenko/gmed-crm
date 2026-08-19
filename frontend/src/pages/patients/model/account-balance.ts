export type PatientBalanceSide = "debit" | "credit" | "settled" | "reconciliation_required";

type PatientBalanceSummary = {
  calculated_balance: string;
  closing_balance: string | null;
  balance_side: "debit" | "credit" | "settled" | "reconciliation_required";
};

export type PatientBalancePresentation = {
  amount: number | null;
  side: PatientBalanceSide;
  needsReconciliation: boolean;
};

export function resolvePatientBalancePresentation(
  summary: PatientBalanceSummary,
): PatientBalancePresentation | null {
  const needsReconciliation =
    summary.closing_balance == null || summary.balance_side === "reconciliation_required";
  if (needsReconciliation) {
    return {
      amount: null,
      side: "reconciliation_required",
      needsReconciliation: true,
    };
  }

  const rawBalance = summary.closing_balance;
  const signedAmount = Number(rawBalance);

  if (!Number.isFinite(signedAmount)) return null;

  return {
    amount: Math.abs(signedAmount),
    side: signedAmount > 0 ? "debit" : signedAmount < 0 ? "credit" : "settled",
    needsReconciliation,
  };
}
