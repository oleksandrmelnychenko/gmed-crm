export type PatientBalanceSide = "debit" | "credit" | "settled" | "reconciliation_required";

type PatientBalanceSummary = {
  closing_balance: string | null;
  balance_side: "debit" | "credit" | "settled" | "reconciliation_required";
};

export type PatientBalancePresentation = {
  amount: number | null;
  side: PatientBalanceSide;
  needsReconciliation: boolean;
};

export function resolvePatientBalancePresentation(
  summary: unknown,
): PatientBalancePresentation | null {
  if (typeof summary !== "object" || summary == null || Array.isArray(summary)) {
    return null;
  }

  const { closing_balance: rawBalance, balance_side: balanceSide } =
    summary as Partial<PatientBalanceSummary>;
  if (
    (rawBalance !== null && typeof rawBalance !== "string") ||
    !["debit", "credit", "settled", "reconciliation_required"].includes(balanceSide ?? "")
  ) {
    return null;
  }

  const needsReconciliation =
    rawBalance == null || balanceSide === "reconciliation_required";
  if (needsReconciliation) {
    return {
      amount: null,
      side: "reconciliation_required",
      needsReconciliation: true,
    };
  }

  if (rawBalance.trim() === "") return null;
  const signedAmount = Number(rawBalance);

  if (!Number.isFinite(signedAmount)) return null;

  return {
    amount: Math.abs(signedAmount),
    side: signedAmount > 0 ? "debit" : signedAmount < 0 ? "credit" : "settled",
    needsReconciliation,
  };
}
