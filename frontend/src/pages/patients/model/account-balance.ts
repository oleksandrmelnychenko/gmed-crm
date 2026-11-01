export type PatientBalanceSide = "debit" | "credit" | "settled" | "reconciliation_required";

type PatientBalanceSummary = {
  closing_balance: string | null;
  /** The calculated balance while a reconciliation is open (staff only, QA 2026-10-31). */
  provisional_balance?: string | null;
  balance_side: "debit" | "credit" | "settled" | "reconciliation_required";
};

type CreditSummary = { closing_balance: string | null; available_prepayment?: string | null };

/**
 * A paid advance is on the credit side until a final invoice bills the
 * services: it is no overpayment next to «still to pay» (QA 2026-11-01, R4-5).
 */
function creditIsPaidAdvance(summary: CreditSummary) {
  const advance = Number(summary.available_prepayment ?? 0);
  return advance > 0 && advance >= Math.abs(Number(summary.closing_balance));
}

/** The word beside a credit balance in the portal. */
export function portalCreditSideLabel(summary: CreditSummary, lang: string) {
  if (creditIsPaidAdvance(summary)) {
    return lang === "de" ? "Vorauszahlung" : "предоплата";
  }
  return lang === "de" ? "Guthaben" : "переплата";
}

/** The same word in the staff card's header (QA 2026-11-01, X2 bug 6). */
export function staffCreditSideLabel(summary: CreditSummary | null | undefined, lang: string) {
  if (summary && creditIsPaidAdvance(summary)) {
    return lang === "de" ? "Vorauszahlung" : "Предоплата";
  }
  return lang === "de" ? "Guthaben" : "Переплата";
}

export type PatientBalancePresentation = {
  amount: number | null;
  /** With the reconciliation still open: the calculated balance with its sign. */
  signedAmount?: number | null;
  side: PatientBalanceSide;
  needsReconciliation: boolean;
};

export function resolvePatientBalancePresentation(
  summary: unknown,
): PatientBalancePresentation | null {
  if (typeof summary !== "object" || summary == null || Array.isArray(summary)) {
    return null;
  }

  const { closing_balance: rawBalance, provisional_balance: provisional, balance_side: balanceSide } =
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
    const provisionalAmount = typeof provisional === "string" && provisional.trim() !== ""
      ? Number(provisional)
      : null;
    const known = provisionalAmount != null && Number.isFinite(provisionalAmount);
    return {
      amount: known ? Math.abs(provisionalAmount) : null,
      ...(known ? { signedAmount: provisionalAmount } : {}),
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
