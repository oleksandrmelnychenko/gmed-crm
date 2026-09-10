import type { PatientAccountMovement, PatientAccountStatement } from "./detail-tab-types";

export type FinancePeriodPreset = "month" | "previous_month" | "quarter" | "year" | "all" | "custom";
export type FinanceDateRange = { from: string; to: string };
export type PatientFinancePeriod = {
  month: string;
  opening: bigint;
  invoices: bigint;
  payments: bigint;
  refunds: bigint;
  adjustments: bigint;
  closing: bigint;
  count: number;
};

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function patientFinanceDateRange(preset: Exclude<FinancePeriodPreset, "custom">, today = new Date()): FinanceDateRange {
  const year = today.getFullYear();
  const month = today.getMonth();
  if (preset === "previous_month") return { from: localDate(new Date(year, month - 1, 1)), to: localDate(new Date(year, month, 0)) };
  const startMonth = preset === "year" ? 0 : preset === "quarter" ? Math.floor(month / 3) * 3 : month;
  return { from: preset === "all" ? "" : localDate(new Date(year, startMonth, 1)), to: localDate(today) };
}

export function isFinanceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// The account statement uses amounts rounded to two decimal places on the server.
// Sum integer minor units so monthly totals match the ledger without float drift.
export function financeCents(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Invalid account amount");
  return (match[1] ? -1n : 1n) * (BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0")));
}

export function financeAmount(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function addMovement(period: PatientFinancePeriod, movement: PatientAccountMovement) {
  const signed = financeCents(movement.debit) - financeCents(movement.credit);
  switch (movement.kind) {
    case "invoice": case "credit_note": case "credit_note_reversal": period.invoices += signed; break;
    case "payment": case "payment_reversal": period.payments -= signed; break;
    case "refund": case "refund_reversal": period.refunds += signed; break;
    default: period.adjustments += signed;
  }
  period.closing += signed;
  period.count++;
}

export function buildPatientFinancePeriods(statement: PatientAccountStatement, range: FinanceDateRange): PatientFinancePeriod[] {
  if ((range.from && !isFinanceDate(range.from)) || !isFinanceDate(range.to) || (range.from && range.from > range.to)) throw new Error("Invalid finance period");
  const movements = [...statement.movements].sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
  for (const movement of movements) {
    if (movement.currency !== statement.currency || !isFinanceDate(movement.entry_date) || movement.entry_date > range.to || (range.from && movement.entry_date < range.from)) throw new Error("Account statement does not match selected period/currency");
  }
  const start = (range.from || movements[0]?.entry_date || range.to).slice(0, 7);
  const finish = range.to.slice(0, 7);
  const grouped = new Map<string, PatientAccountMovement[]>();
  for (const movement of movements) {
    const key = movement.entry_date.slice(0, 7);
    const bucket = grouped.get(key) ?? [];
    bucket.push(movement);
    grouped.set(key, bucket);
  }
  let opening = financeCents(statement.summary.opening_balance);
  const periods: PatientFinancePeriod[] = [];
  const monthIndex = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5)) - 1;
  for (let index = monthIndex(start); index <= monthIndex(finish); index++) {
    const key = `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
    const period: PatientFinancePeriod = { month: key, opening, invoices: 0n, payments: 0n, refunds: 0n, adjustments: 0n, closing: opening, count: 0 };
    for (const movement of grouped.get(key) ?? []) addMovement(period, movement);
    periods.push(period);
    opening = period.closing;
  }
  if (opening !== financeCents(statement.summary.calculated_balance)) throw new Error("Account statement does not reconcile");
  return periods;
}
