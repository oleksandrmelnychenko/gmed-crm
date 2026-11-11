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

/**
 * A money amount as staff type it, in the API's "1234.56" form, or null when
 * it cannot be read safely. The comma is the decimal mark and dots group
 * thousands: "119,50", "1.234,56", "1.500" (QA 2026-10-31: «1.500» was booked
 * as 1,50 €), and the plain "1234.56". Money has two decimals, so anything
 * longer ("1,500", "12.3456") is refused instead of guessed.
 */
export function normalizeMoneyInput(value: string): string | null {
  const compact = value.trim().replace(/\s/gu, "");
  if (/^-?[1-9]\d{0,2}(?:\.\d{3})+(?:,\d{1,2})?$/u.test(compact)) {
    return compact.replace(/\./gu, "").replace(",", ".");
  }
  return /^-?\d+(?:[.,]\d{1,2})?$/u.test(compact) ? compact.replace(",", ".") : null;
}

/**
 * A stored amount ("87.40") as staff type it ("87,40"): the field showed the
 * API's dot after saving a comma (QA 2026-11-01, U-6). "" for nothing stored.
 */
export function moneyInputText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2).replace(".", ",") : String(value);
}

/** The typed amount as a number, NaN when {@link normalizeMoneyInput} refuses it. */
export function parseMoneyInput(value: string): number {
  const normalized = normalizeMoneyInput(value);
  return normalized === null ? Number.NaN : Number(normalized);
}

/** Why a typed amount cannot be taken; null when it can (or the field is empty). */
export type MoneyInputProblem = "unreadable" | "not_positive" | "negative";

/**
 * Checks a typed amount the way every money field does (owner 2026-11-11:
 * German money format everywhere): "1.234,56", "1234,56" and "1234.56" are
 * read, anything else is "unreadable"; zero and negative amounts only where
 * the field allows them. An empty field is no problem here (`required` is).
 */
export function moneyInputProblem(
  value: string,
  options: { allowZero?: boolean; allowNegative?: boolean } = {},
): MoneyInputProblem | null {
  if (value.trim() === "") return null;
  const amount = parseMoneyInput(value);
  if (Number.isNaN(amount)) return "unreadable";
  if (amount < 0 && !options.allowNegative) return options.allowZero ? "negative" : "not_positive";
  if (amount === 0 && !options.allowZero) return "not_positive";
  return null;
}

const MONEY_INPUT_MESSAGES: Record<"ru" | "de", Record<MoneyInputProblem, string>> = {
  ru: {
    unreadable: "Введите сумму числом, например 119,00 или 1.234,56.",
    not_positive: "Введите сумму больше нуля, например 119,00.",
    negative: "Сумма не может быть отрицательной.",
  },
  de: {
    unreadable: "Bitte den Betrag als Zahl eingeben, z. B. 119,00 oder 1.234,56.",
    not_positive: "Bitte einen Betrag größer als null eingeben, z. B. 119,00.",
    negative: "Der Betrag darf nicht negativ sein.",
  },
};

/** The message of a money field problem in the UI language. */
export function moneyInputMessage(problem: MoneyInputProblem, lang: string): string {
  return MONEY_INPUT_MESSAGES[lang === "de" ? "de" : "ru"][problem];
}

/**
 * A typed amount for the API ("1.234,56" → "1234.56"), or null when the field
 * is empty or cannot be read. The value sent stays the same number as before
 * the German input; only the typing changed.
 */
export function moneyInputPayload(value: string): string | null {
  if (value.trim() === "") return null;
  return normalizeMoneyInput(value);
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

function moneyNumber(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(numeric) ? numeric : 0;
}

export function formatMoneyAmount(value: unknown, currency = "EUR"): string {
  return moneyFormatter(currency).format(moneyNumber(value));
}

const MONEY_NUMBER = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function isEuro(currency: string | null | undefined): boolean {
  const code = (currency ?? "").trim().toUpperCase();
  return code === "" || code === "EUR";
}

/**
 * Money shown next to an ISO currency code ("… EUR" before): euros read
 * "1.234,56 €" in every UI language (owner rule); another currency keeps its
 * code, "1.234,56 USD".
 */
export function formatMoneyLabel(value: unknown, currency?: string | null): string {
  if (isEuro(currency)) return formatMoneyAmount(value, "EUR");
  return `${MONEY_NUMBER.format(moneyNumber(value))}\u00a0${(currency ?? "").trim().toUpperCase()}`;
}

const RECOGNIZED_MONEY_NUMBER = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/**
 * An amount read from an imported document (XML/OCR preview): "8,50 €", a
 * unit price keeps up to four decimals ("0,1234 €"); text that is no number
 * stays as read.
 */
export function formatRecognizedMoney(value: unknown, currency?: string | null): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const numeric = Number(raw.replace(",", "."));
  const code = (currency ?? "").trim().toUpperCase();
  const unit = isEuro(currency) ? "€" : code;
  if (!Number.isFinite(numeric)) return code ? `${raw} ${code}` : raw;
  return `${RECOGNIZED_MONEY_NUMBER.format(numeric)}\u00a0${unit}`;
}

/** A price range, "250,00 – 1.000,00 €" (the currency once, after the upper bound). */
export function formatMoneyRange(minimum: unknown, maximum: unknown, currency?: string | null): string {
  return `${MONEY_NUMBER.format(moneyNumber(minimum))} – ${formatMoneyLabel(maximum, currency)}`;
}
