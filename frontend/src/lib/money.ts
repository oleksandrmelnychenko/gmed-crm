// Single money style for every table in the app: de-DE currency formatting —
// dot thousands, comma decimals, currency sign AFTER the amount ("1.234,56 €").
// Do not localize: the pattern is a product decision, not a locale preference.
const MONEY_FORMATTERS = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string) {
  const cached = MONEY_FORMATTERS.get(currency);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  MONEY_FORMATTERS.set(currency, formatter);
  return formatter;
}

// Commercial rounding (kaufmännisches Runden): ties go half away from zero
// (45.125 -> 45.13, -45.125 -> -45.13). The server (`crates/server/src/money.rs`)
// and PostgreSQL ROUND(numeric) use the same rule, so client totals match
// quotes, invoices and settlements to the cent.

/** Integer cents of `value`, commercially rounded. */
export function toCents(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  // 15 significant digits strip binary noise (1.005 * 100 = 100.49999…) so a
  // decimal tie is still seen as a tie.
  const cents = Math.round(Number((Math.abs(value) * 100).toPrecision(15)));
  return value < 0 && cents !== 0 ? -cents : cents;
}

/** `value` rounded to cents, ties half away from zero. */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return value;
  return toCents(value) / 100;
}

/** Whether two money amounts are equal once rounded to cents. */
export function sameCents(left: number, right: number): boolean {
  return toCents(left) === toCents(right);
}

export type MoneyLineAmounts = { net: number; vat: number; gross: number };

/**
 * Amounts of one quote/order/invoice line, rounded like the server:
 * net = round(quantity × unit price), VAT = round(net × rate / 100),
 * gross = net + VAT. Document totals are sums of these rounded lines.
 */
export function moneyLineAmounts(
  quantity: number,
  unitPriceNet: number,
  vatRatePercent: number,
): MoneyLineAmounts {
  const net = roundCents(quantity * unitPriceNet);
  const vat = roundCents((net * vatRatePercent) / 100);
  return { net, vat, gross: roundCents(net + vat) };
}

export function formatMoneyAmount(value: unknown, currency = "EUR"): string {
  const numeric =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").trim().replace(",", "."));
  return moneyFormatter(currency).format(Number.isFinite(numeric) ? numeric : 0);
}
