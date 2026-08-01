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

export function formatMoneyAmount(value: unknown, currency = "EUR"): string {
  const numeric =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").trim().replace(",", "."));
  return moneyFormatter(currency).format(Number.isFinite(numeric) ? numeric : 0);
}
