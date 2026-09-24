import { formatIntakeDate } from "@/pages/orders/model/order-intake";

export type OrderPeriodWarning = { key: "past" | "started" | "before_contract"; ru: string; de: string };

/**
 * Soft warnings for the order period. Orders are sometimes recorded after the
 * fact, so nothing here blocks; it only makes a past period or a period that
 * the selected contract does not reach visible before signatures are collected.
 */
export function orderPeriodWarnings(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  contract: { contract_number: string; valid_from: string | null } | null,
  today = new Date().toISOString().slice(0, 10),
): OrderPeriodWarning[] {
  const warnings: OrderPeriodWarning[] = [];
  if (dateTo && dateTo < today) {
    warnings.push({
      key: "past",
      ru: `Период заказа уже прошёл (${formatIntakeDate(dateFrom)} – ${formatIntakeDate(dateTo)}). Проверьте даты, если заказ не оформляется задним числом.`,
      de: `Der Auftragszeitraum liegt in der Vergangenheit (${formatIntakeDate(dateFrom)} – ${formatIntakeDate(dateTo)}). Bitte Daten prüfen, sofern der Auftrag nicht nachträglich erfasst wird.`,
    });
  } else if (dateFrom && dateFrom < today) {
    warnings.push({
      key: "started",
      ru: `Начало периода заказа уже прошло (${formatIntakeDate(dateFrom)}).`,
      de: `Der Auftragsbeginn liegt in der Vergangenheit (${formatIntakeDate(dateFrom)}).`,
    });
  }
  if (contract?.valid_from && dateFrom && dateFrom < contract.valid_from) {
    warnings.push({
      key: "before_contract",
      ru: `Период начинается раньше, чем действует договор ${contract.contract_number} (с ${formatIntakeDate(contract.valid_from)}). Измените даты программы или дату начала договора.`,
      de: `Der Zeitraum beginnt vor der Gültigkeit von Vertrag ${contract.contract_number} (ab ${formatIntakeDate(contract.valid_from)}). Programmdaten oder Vertragsbeginn anpassen.`,
    });
  }
  return warnings;
}
