import { ApiRequestError } from "@/lib/api";
import type { Lang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";

import type {
  TerminationSettlement,
  TerminationSettlementLine,
  TerminationSettlementStatus,
} from "./api";

/** Amounts below half a cent count as zero (decimal strings may carry noise). */
const EPSILON = 0.005;

export type SettlementBalanceTone = "owed" | "refund" | "even";

/** Parses a decimal string ("749.7", "-12,50") into a number; invalid → 0. */
export function toAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const numeric = Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function isPositiveAmount(value: unknown) {
  return toAmount(value) >= EPSILON;
}

/** Positive balance = patient owes, negative = refund due, zero = settled even. */
export function settlementBalanceTone(balance: unknown): SettlementBalanceTone {
  const amount = toAmount(balance);
  if (amount >= EPSILON) return "owed";
  if (amount <= -EPSILON) return "refund";
  return "even";
}

export function settlementBalanceLabel(balance: unknown, currency: string, lang: Lang) {
  const de = lang === "de";
  const tone = settlementBalanceTone(balance);
  const amount = formatMoneyAmount(Math.abs(toAmount(balance)), currency || "EUR");
  if (tone === "owed") return de ? `Patient schuldet ${amount}` : `Пациент должен ${amount}`;
  if (tone === "refund") return de ? `Erstattung an Patient ${amount}` : `Вернуть пациенту ${amount}`;
  return de ? `Ausgeglichen: ${amount}` : `Итог: ${amount}`;
}

export function settlementBalanceClass(balance: unknown) {
  switch (settlementBalanceTone(balance)) {
    case "owed":
      return "text-amber-700";
    case "refund":
      return "text-rose-700";
    default:
      return "text-emerald-700";
  }
}

export function settlementStatusLabel(status: TerminationSettlementStatus, lang: Lang) {
  if (status === "settled") return lang === "de" ? "Abgeschlossen" : "Закрыт";
  return lang === "de" ? "Offen" : "Открыт";
}

const INVOICE_STATUS_LABELS: Record<string, [ru: string, de: string]> = {
  draft: ["Черновик", "Entwurf"],
  sent: ["Отправлен", "Versendet"],
  partially_paid: ["Частично оплачен", "Teilweise bezahlt"],
  paid: ["Оплачен", "Bezahlt"],
  overdue: ["Просрочен", "Überfällig"],
  cancelled: ["Отменён", "Storniert"],
};

export function finalInvoiceStatusLabel(status: string, lang: Lang) {
  const labels = INVOICE_STATUS_LABELS[status];
  if (!labels) return status;
  return lang === "de" ? labels[1] : labels[0];
}

const LINE_STATUS_LABELS: Record<string, [ru: string, de: string]> = {
  planned: ["Запланировано", "Geplant"],
  delivered: ["Оказано", "Erbracht"],
  approved: ["Подтверждено", "Freigegeben"],
  invoiced: ["Выставлено", "Abgerechnet"],
  cancelled: ["Отменено", "Storniert"],
  received: ["Получен", "Eingegangen"],
  paid: ["Оплачен", "Bezahlt"],
};

export function settlementLineStatusLabel(line: Pick<TerminationSettlementLine, "status" | "due_in_full">, lang: Lang) {
  if (line.due_in_full) return lang === "de" ? "Pauschale, voll fällig" : "Паушал, полностью";
  const labels = LINE_STATUS_LABELS[line.status];
  if (!labels) return line.status;
  return lang === "de" ? labels[1] : labels[0];
}

export function countDueInFull(lines: TerminationSettlementLine[]) {
  return lines.filter((line) => line.due_in_full).length;
}

/** "Create final invoice" needs an open settlement with an uninvoiced accrued amount. */
export function canCreateFinalInvoice(settlement: Pick<TerminationSettlement, "status" | "current">) {
  return settlement.status === "open" && isPositiveAmount(settlement.current.uninvoiced_gross);
}

export const FORCE_SETTLE_NOTE_MIN = 3;

export function isValidForceNote(note: string) {
  return note.trim().length >= FORCE_SETTLE_NOTE_MIN;
}

/** User-facing message for final-invoice / settle failures. */
export function settlementActionErrorMessage(error: unknown, lang: Lang, fallback: string) {
  const de = lang === "de";
  if (error instanceof ApiRequestError) {
    const code = typeof error.body?.error === "string" ? error.body.error : error.code;
    if (code === "nothing_to_invoice") {
      return de
        ? "Es gibt keinen noch nicht berechneten Betrag."
        : "Нет невыставленной суммы для финального счёта.";
    }
    if (code === "termination_settlement_not_balanced") {
      return de
        ? "Die Abrechnung ist noch nicht ausgeglichen: Saldo und nicht berechneter Betrag müssen 0 sein."
        : "Расчёт ещё не сведён: остаток и невыставленная сумма должны быть равны 0.";
    }
    if (error.status === 409) {
      return de ? "Die Abrechnung ist bereits abgeschlossen." : "Расчёт уже закрыт.";
    }
    if (error.status === 403) {
      return de ? "Keine Berechtigung für diese Aktion." : "Нет прав на это действие.";
    }
  }
  return fallback;
}
