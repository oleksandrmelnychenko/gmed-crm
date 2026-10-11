/**
 * Plural forms for counts in staff texts: Russian has three (1 документ,
 * 2 документа, 5 документов — 11–14 take the third), German two.
 */

export type RussianPluralForms = { one: string; few: string; many: string };

/** Which Russian form a count takes. */
export function russianPluralForm(count: number): keyof RussianPluralForms {
  const value = Math.abs(Math.trunc(count));
  const lastTwo = value % 100;
  const last = value % 10;
  if (last === 1 && lastTwo !== 11) return "one";
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return "few";
  return "many";
}

/** The Russian word for a count (without the number). */
export function pluralRu(count: number, forms: RussianPluralForms): string {
  return forms[russianPluralForm(count)];
}

/** The German word for a count (without the number): singular for exactly one. */
export function pluralDe(count: number, one: string, other: string): string {
  return Math.abs(count) === 1 ? one : other;
}
