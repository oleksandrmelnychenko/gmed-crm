import { formatIntakeDate } from "@/pages/orders/model/order-intake";

export type OrderPeriodWarning = { key: "past" | "started"; ru: string; de: string };

/**
 * Soft warnings for the order period. Orders are sometimes recorded after the
 * fact, so nothing here blocks; it only makes a past period visible before
 * signatures are collected. The framework contract has no validity period, so
 * the dates are never compared with it.
 */
export function orderPeriodWarnings(
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
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
  return warnings;
}
