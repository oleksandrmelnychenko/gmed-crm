import { toCents } from "@/lib/money";

/**
 * A planned partner cost as typed: net, the partner's VAT amount and gross.
 * `source` is the amount the user entered last (net or gross); the other one
 * is derived, because the server refuses a cost whose gross is not net plus
 * VAT to the cent (`validate_money_components`).
 */
export type PartnerCostAmounts = {
  net: string;
  vat: string;
  gross: string;
  source: "net" | "gross";
};

export function blankPartnerCostAmounts(): PartnerCostAmounts {
  return { net: "", vat: "", gross: "", source: "net" };
}

/** Amounts saved on a service, as the planned-cost editor starts from them. */
export function partnerCostAmountsFrom(
  net: unknown,
  vat: unknown,
  gross: unknown,
): PartnerCostAmounts {
  const text = (value: unknown) => String(value ?? "0");
  return { net: text(net), vat: text(vat), gross: text(gross), source: "net" };
}

/** Cents of a typed non-negative amount ("12,50" or "12.50"); blank is 0. */
function amountCents(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return 0;
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const cents = toCents(Number(normalized));
  return Number.isSafeInteger(cents) ? cents : null;
}

function centsText(cents: number) {
  return (cents / 100).toFixed(2);
}

/**
 * Applies an edit to one amount and derives the other: editing net (or VAT
 * after net) recomputes gross = net + VAT; editing gross (or VAT after gross)
 * recomputes net = gross − VAT. A derived amount stays empty while an input is
 * not an amount or VAT exceeds gross.
 */
export function editPartnerCostAmounts(
  current: PartnerCostAmounts,
  field: "net" | "vat" | "gross",
  value: string,
): PartnerCostAmounts {
  const next: PartnerCostAmounts = { ...current, [field]: value };
  if (field !== "vat") next.source = field;
  const vat = amountCents(next.vat);
  if (next.source === "net") {
    const net = amountCents(next.net);
    const empty = !next.net.trim() && !next.vat.trim();
    next.gross = empty || net === null || vat === null ? "" : centsText(net + vat);
  } else {
    const gross = amountCents(next.gross);
    next.net =
      !next.gross.trim() || gross === null || vat === null || vat > gross
        ? ""
        : centsText(gross - vat);
  }
  return next;
}

export function partnerCostAmountsHint(lang: "de" | "ru") {
  return lang === "de"
    ? "Brutto = Netto + Mehrwertsteuer. Geben Sie Netto oder Brutto ein, der andere Betrag wird berechnet."
    : "Сумма с налогом = сумма без налога + налог. Введите сумму без налога или с налогом — другая рассчитается автоматически.";
}

export function partnerCostAmountsError(lang: "de" | "ru") {
  return lang === "de"
    ? "Geplante Partnerkosten: Bitte nicht negative Beträge angeben; die Mehrwertsteuer darf den Bruttobetrag nicht übersteigen."
    : "Плановые затраты на партнёра: укажите неотрицательные суммы; налог не может превышать сумму с налогом.";
}

/**
 * The amounts to send, rounded to cents, or null when one is not a
 * non-negative amount or gross is not net plus VAT.
 */
export function partnerCostAmountsForSubmit(
  amounts: PartnerCostAmounts,
): { net: number; vat: number; gross: number } | null {
  const net = amountCents(amounts.net);
  const vat = amountCents(amounts.vat);
  const gross = amountCents(amounts.gross);
  if (net === null || vat === null || gross === null || net + vat !== gross) {
    return null;
  }
  return { net: net / 100, vat: vat / 100, gross: gross / 100 };
}
