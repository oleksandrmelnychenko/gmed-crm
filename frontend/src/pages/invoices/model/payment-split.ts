/**
 * Owner 2026-11-15: a payment that pays an advance only in part is split pro
 * rata over its VAT categories; staff may set the split by hand. The server
 * validates the same rules (sum = payment, no negative part, no part above
 * what its category has open).
 */
import { roundCents, toCents } from "@/lib/money";

import type { AdvanceCategory } from "./types";

export type PaymentSplitValues = Record<string, string>;

export function categoryKey(category: Pick<AdvanceCategory, "kind" | "vat_rate">) {
  return `${category.kind}:${Number(category.vat_rate)}`;
}

export function categoryLabel(category: Pick<AdvanceCategory, "kind" | "vat_rate">, lang: string) {
  const de = lang === "de";
  if (category.kind === "passthrough") return de ? "Auslagen (ohne USt.)" : "Перевыставляемые расходы (без НДС)";
  if (category.kind === "zero_rated") return de ? "GMED-Leistungen 0 %" : "Услуги GMED 0 %";
  return de ? `GMED-Leistungen ${Number(category.vat_rate)} % USt.` : `Услуги GMED, НДС ${Number(category.vat_rate)} %`;
}

/** The categories with something still open. */
export function openCategories(categories: AdvanceCategory[] | undefined) {
  return (categories ?? []).filter((category) => toCents(Number(category.open_gross)) > 0);
}

/**
 * Whether a payment of `amount` is a part payment that can be split: more
 * than one open category and less than what is open in total.
 */
export function paymentSplitOffered(categories: AdvanceCategory[] | undefined, amount: number) {
  const open = openCategories(categories);
  const openTotal = open.reduce((sum, category) => sum + toCents(Number(category.open_gross)), 0);
  return open.length > 1 && toCents(amount) > 0 && toCents(amount) < openTotal;
}

/** Pro rata over the open amounts, the last category taking the cents. */
export function proRataSplit(categories: AdvanceCategory[] | undefined, amount: number): PaymentSplitValues {
  const open = openCategories(categories);
  const total = open.reduce((sum, category) => sum + Number(category.open_gross), 0);
  const values: PaymentSplitValues = {};
  let left = roundCents(amount);
  open.forEach((category, index) => {
    const share = index === open.length - 1 || total <= 0
      ? left
      : roundCents((amount * Number(category.open_gross)) / total);
    left = roundCents(left - share);
    values[categoryKey(category)] = share.toFixed(2);
  });
  return values;
}

/** The first problem of a split, as one short sentence; null when valid. */
export function paymentSplitProblem(
  categories: AdvanceCategory[] | undefined,
  amount: number,
  values: PaymentSplitValues,
  lang: string,
): string | null {
  const de = lang === "de";
  let sum = 0;
  for (const category of openCategories(categories)) {
    const raw = (values[categoryKey(category)] ?? "").replace(",", ".").trim();
    const value = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      return de ? "Ein Anteil ist ungültig." : "Доля указана неверно.";
    }
    if (toCents(value) > toCents(Number(category.open_gross))) {
      return de ? "Ein Anteil ist größer als der offene Betrag seiner Kategorie." : "Доля больше открытого остатка категории.";
    }
    sum += toCents(value);
  }
  if (sum !== toCents(amount)) {
    return de ? "Die Anteile ergeben nicht den Zahlungsbetrag." : "Сумма долей не равна сумме платежа.";
  }
  return null;
}

/** The request field `category_split`. */
export function paymentSplitPayload(categories: AdvanceCategory[] | undefined, values: PaymentSplitValues) {
  return openCategories(categories).map((category) => ({
    kind: category.kind,
    vat_rate: category.kind === "taxed" ? category.vat_rate : "0",
    amount_gross: roundCents(Number((values[categoryKey(category)] ?? "0").replace(",", ".")) || 0).toFixed(2),
  }));
}
