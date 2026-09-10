import { describe, expect, it } from "vitest";
import { buildPatientFinancePeriods, financeAmount, financeCents, isFinanceDate, patientFinanceDateRange } from "./finance-periods";
import type { PatientAccountMovement, PatientAccountStatement } from "./detail-tab-types";

function movement(kind: PatientAccountMovement["kind"], date: string, debit: string, credit = "0"): PatientAccountMovement {
  return { id: `${kind}:${date}:${debit}:${credit}`, kind, entry_date: date, occurred_at: `${date}T12:00:00Z`, direction: debit === "0" ? "credit" : "debit", description: "", debit, credit, balance_after: "0", currency: "EUR" };
}
function statement(movements: PatientAccountMovement[], opening: string, closing: string): PatientAccountStatement {
  return { patient_id: "patient-1", currency: "EUR", available_currencies: ["EUR"], scope: "staff", amounts_complete: true,
    summary: { invoiced_gross: "0", cash_paid: "0", prepayment_applied: "0", available_prepayment: "0", invoice_due: "0", external_receivable: "0", total_due: closing, reconciliation_required: false, opening_balance: opening, debit_total: "0", credit_total: "0", calculated_balance: closing, closing_balance: closing, balance_side: "debit", unreconciled_external_debit: "0" },
    redaction: { hidden_invoice_amount_count: 0, external_expense_count: 0, services_hidden: false }, movements, items: [] };
}

describe("patient finance periods", () => {
  it("carries earlier debt through empty months and separates invoice and payment months", () => {
    const periods = buildPatientFinancePeriods(statement([
      movement("payment", "2026-03-10", "0", "70"), movement("invoice", "2026-01-15", "100"),
    ], "25", "55"), { from: "2026-01-01", to: "2026-03-31" });
    expect(periods.map(p => [p.month, p.opening, p.invoices, p.payments, p.closing])).toEqual([
      ["2026-01", 2500n, 10000n, 0n, 12500n], ["2026-02", 12500n, 0n, 0n, 12500n], ["2026-03", 12500n, 0n, 7000n, 5500n],
    ]);
  });
  it("does not mistake credit notes for received money and nets reversals in the proper category", () => {
    const rows = [movement("invoice", "2026-09-01", "100"), movement("credit_note", "2026-09-02", "0", "20"), movement("credit_note_reversal", "2026-09-03", "5"),
      movement("payment", "2026-09-04", "0", "80"), movement("payment_reversal", "2026-09-05", "10"),
      movement("refund", "2026-09-06", "15"), movement("refund_reversal", "2026-09-07", "0", "5"),
      movement("balance_adjustment", "2026-09-08", "4"), movement("external_receivable", "2026-09-09", "6")];
    const [period] = buildPatientFinancePeriods(statement(rows, "0", "35"), { from: "2026-09-01", to: "2026-09-30" });
    expect(period).toMatchObject({ invoices: 8500n, payments: 7000n, refunds: 1000n, adjustments: 1000n, closing: 3500n });
  });
  it("sums cents exactly and preserves credit balances", () => {
    const [period] = buildPatientFinancePeriods(statement([movement("payment", "2026-09-01", "0", "0.10"), movement("payment", "2026-09-02", "0", "0.20")], "0", "-0.30"), { from: "", to: "2026-09-30" });
    expect(financeAmount(period.closing)).toBe("-0.30");
    expect(financeCents("999999999999.99") + 1n).toBe(100000000000000n);
    expect(() => financeCents("1.234")).toThrow();
  });
  it("retains an opening balance for an empty period", () => {
    expect(buildPatientFinancePeriods(statement([], "-20", "-20"), { from: "2026-08-15", to: "2026-09-09" }).map(p => p.closing)).toEqual([-2000n, -2000n]);
  });
  it("rejects inconsistent currency, dates and closing totals instead of displaying wrong money", () => {
    const item = movement("invoice", "2026-09-01", "50");
    const range = { from: "2026-09-01", to: "2026-09-30" };
    expect(() => buildPatientFinancePeriods(statement([{ ...item, currency: "USD" }], "0", "50"), range)).toThrow();
    expect(() => buildPatientFinancePeriods(statement([{ ...item, entry_date: "2026-08-31" }], "0", "50"), range)).toThrow();
    expect(() => buildPatientFinancePeriods(statement([item], "0", "49"), range)).toThrow();
    expect(() => buildPatientFinancePeriods(statement([], "0", "0"), { from: "2026-10-01", to: "2026-09-30" })).toThrow();
  });
  it("handles leap years, quarter boundaries and date validation", () => {
    expect(patientFinanceDateRange("previous_month", new Date(2024, 2, 10))).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(patientFinanceDateRange("previous_month", new Date(2026, 0, 10))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(patientFinanceDateRange("quarter", new Date(2026, 8, 10))).toEqual({ from: "2026-07-01", to: "2026-09-10" });
    expect(isFinanceDate("2026-02-29")).toBe(false);
    expect(isFinanceDate("2024-02-29")).toBe(true);
    expect(buildPatientFinancePeriods(statement([], "0", "0"), { from: "9999-12-01", to: "9999-12-31" })).toHaveLength(1);
  });
});
