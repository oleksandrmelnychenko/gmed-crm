import type { Lang } from "./index";

/** Word forms by count: Russian one / few / many, German one / other. */
export interface PluralWords {
  ru: readonly [one: string, few: string, many: string];
  de: readonly [one: string, other: string];
}

/**
 * The word form that goes with `count` ("1 карта", "2 карты", "5 карт";
 * "1 Akte", "2 Akten"). Fractions take the Russian "few" form ("2,5 дня").
 */
export function pluralWord(lang: Lang, count: number, words: PluralWords): string {
  if (lang === "de") return Math.abs(count) === 1 ? words.de[0] : words.de[1];
  if (!Number.isInteger(count)) return words.ru[1];
  const n = Math.abs(count);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return words.ru[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return words.ru[1];
  return words.ru[2];
}

/** "3 карты" / "3 Akten". */
export function formatCount(lang: Lang, count: number, words: PluralWords): string {
  return `${count} ${pluralWord(lang, count, words)}`;
}
