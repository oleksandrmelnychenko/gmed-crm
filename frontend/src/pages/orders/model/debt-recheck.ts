import { formatMoneyAmount } from "@/lib/money";

import type { OverdueInvoiceSummary } from "./types";

/**
 * The debt line of the re-check before a new order, from one source: the
 * overdue invoices of the patient (QA D2-08). Debt never blocks a new order
 * (owner decision), so the panel names the overdue invoices — also those of a
 * third-party payer — instead of saying "no overdue debt" next to a count.
 */
export function debtRecheckCopy(
  overdueCount: number,
  invoices: readonly OverdueInvoiceSummary[] | undefined,
  lang: string,
) {
  const de = lang === "de";
  if (!(overdueCount > 0)) {
    return {
      overdue: false,
      label: de ? "Keine überfälligen Rechnungen" : "Просроченной задолженности нет",
      badge: de ? "Ja" : "Да",
      summary: de ? "Keine überfälligen Forderungen erkannt." : "Просроченной задолженности не найдено.",
      invoices: [] as string[],
    };
  }
  const listed = (invoices ?? []).map((invoice) => {
    const recipient = invoice.recipient_name?.trim() || (de ? "Patient" : "пациент");
    const payer = invoice.billed_to_patient
      ? recipient
      : `${recipient} (${de ? "abweichender Zahler" : "сторонний плательщик"})`;
    return `${invoice.invoice_number ?? "—"} · ${payer} · ${formatMoneyAmount(invoice.balance_due)}`;
  });
  return {
    overdue: true,
    label: de ? `Überfällige Rechnungen: ${overdueCount}` : `Просрочено счетов: ${overdueCount}`,
    badge: de ? "Blockiert nicht" : "Не блокирует",
    summary: de
      ? `Überfällige Rechnungen: ${overdueCount}. Ein neuer Auftrag wird dadurch nicht blockiert; bitte mit der Buchhaltung abstimmen.`
      : `Есть просроченные счета: ${overdueCount}. Новый заказ это не блокирует; согласуйте с бухгалтерией.`,
    invoices: listed,
  };
}
